import { afterEach, describe, expect, it } from "vitest";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceSummary,
} from "../src/auth/types.js";
import { DuplicateEmailError } from "../src/auth/errors.js";
import { authenticate, requireWorkspaceRole } from "../src/auth/routes.js";
import { buildApp } from "../src/app.js";

class InMemoryAuthRepository implements AuthRepository {
  private sequence = 0;
  private readonly users = new Map<string, AuthUser>();
  private readonly workspaces = new Map<string, WorkspaceSummary[]>();
  private readonly memberships = new Map<string, WorkspaceRole>();

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.users.get(email) ?? null;
  }

  async createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }> {
    if (this.users.has(input.email)) {
      throw new DuplicateEmailError();
    }
    const user = { id: this.nextId("user"), ...input };
    const workspace = this.addWorkspace(user.id, "Personal workspace", "OWNER");
    this.users.set(user.email, user);
    return { user, workspace };
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return this.workspaces.get(userId) ?? [];
  }

  async createWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
    return this.addWorkspace(userId, name, "OWNER");
  }

  async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembership | null> {
    const role = this.memberships.get(`${workspaceId}:${userId}`);
    return role ? { role } : null;
  }

  setMembershipRole(userId: string, workspaceId: string, role: WorkspaceRole): void {
    this.memberships.set(`${workspaceId}:${userId}`, role);
  }

  private addWorkspace(
    userId: string,
    name: string,
    role: WorkspaceRole,
  ): WorkspaceSummary {
    const workspace = {
      id: this.nextId("workspace"),
      name,
      role,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    this.workspaces.set(userId, [...(this.workspaces.get(userId) ?? []), workspace]);
    this.memberships.set(`${workspace.id}:${userId}`, role);
    return workspace;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

describe("authentication and workspace access", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp(repository = new InMemoryAuthRepository()) {
    const app = buildApp({
      auth: {
        repository,
        jwtSecret: "test-secret-that-is-at-least-thirty-two-characters",
      },
      logger: false,
    });
    apps.push(app);
    return { app, repository };
  }

  async function register(app: ReturnType<typeof buildApp>, email = "user@example.com") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "long enough password 123" },
    });
    return response.json() as {
      accessToken: string;
      user: { id: string; email: string };
      workspace: { id: string; role: string };
    };
  }

  it("registers a normalized user with an owner personal workspace and access token", async () => {
    const { app, repository } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "  USER@Example.com ", password: "long enough password 123" },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.user.email).toBe("user@example.com");
    expect(body.workspace).toMatchObject({ name: "Personal workspace", role: "OWNER" });
    expect(body.accessToken).toEqual(expect.any(String));
    const stored = await repository.findUserByEmail("user@example.com");
    expect(stored?.passwordHash).not.toContain("long enough password 123");

    const profile = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual(body.user);
  });

  it("rejects duplicate identities and invalid credentials without revealing which failed", async () => {
    const { app } = createApp();
    await register(app);
    const duplicate = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "USER@example.com", password: "long enough password 123" },
    });
    expect(duplicate.statusCode).toBe(409);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "user@example.com", password: "wrong password" },
    });
    const unknownUser = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "missing@example.com", password: "wrong password" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
  });

  it("allows login with a normalized email and the registered password", async () => {
    const { app } = createApp();
    await register(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: " USER@Example.com ", password: "long enough password 123" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: "Bearer",
      expiresIn: 900,
      user: { email: "user@example.com" },
    });
    expect(response.json().accessToken).toEqual(expect.any(String));
  });

  it("validates registration payloads and requires authentication for workspace access", async () => {
    const { app } = createApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "short" },
    });
    expect(invalid.statusCode).toBe(400);

    const workspaces = await app.inject({ method: "GET", url: "/workspaces" });
    expect(workspaces.statusCode).toBe(401);
  });

  it("limits workspace authorization to memberships and required roles", async () => {
    const { app, repository } = createApp();
    app.get(
      "/test/workspaces/:workspaceId/owner-only",
      {
        preHandler: [
          authenticate,
          requireWorkspaceRole(repository, ["OWNER"]),
        ],
      },
      async () => ({ authorized: true }),
    );
    const account = await register(app);

    const accessible = await app.inject({
      method: "GET",
      url: `/test/workspaces/${account.workspace.id}/owner-only`,
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    const outsideWorkspace = await app.inject({
      method: "GET",
      url: "/test/workspaces/foreign-workspace/owner-only",
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    repository.setMembershipRole(account.user.id, account.workspace.id, "MEMBER");
    const insufficientRole = await app.inject({
      method: "GET",
      url: `/test/workspaces/${account.workspace.id}/owner-only`,
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(accessible.statusCode).toBe(200);
    expect(outsideWorkspace.statusCode).toBe(404);
    expect(insufficientRole.statusCode).toBe(403);
  });

  it("creates and lists additional workspaces for the authenticated user", async () => {
    const { app } = createApp();
    const account = await register(app);
    const headers = { authorization: `Bearer ${account.accessToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers,
      payload: { name: "Team workspace" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Team workspace", role: "OWNER" });

    const listed = await app.inject({ method: "GET", url: "/workspaces", headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(2);
  });

  it("rate-limits authentication attempts with a stable safe error", async () => {
    const { app } = createApp();
    let lastResponse;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      lastResponse = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "missing@example.com", password: "not the password" },
      });
    }
    expect(lastResponse?.statusCode).toBe(429);
    expect(lastResponse?.json()).toEqual({
      error: "Too Many Requests",
      message: "Rate limit exceeded",
    });
  });
});
