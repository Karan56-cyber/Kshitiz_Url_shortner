import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceSummary,
  PasswordResetRepository,
} from "../src/auth/types.js";
import type { PasswordResetMailer } from "../src/auth/password-reset-mailer.js";
import { DuplicateEmailError } from "../src/auth/errors.js";
import { authenticate, requireWorkspaceRole } from "../src/auth/routes.js";
import { buildApp } from "../src/app.js";

class InMemoryAuthRepository implements AuthRepository, PasswordResetRepository {
  private sequence = 0;
  private readonly users = new Map<string, AuthUser>();
  private readonly workspaces = new Map<string, WorkspaceSummary[]>();
  private readonly memberships = new Map<string, WorkspaceRole>();
  private readonly resetTokens = new Map<
    string,
    { userId: string; expiresAt: Date; usedAt: Date | null }
  >();

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.users.get(email) ?? null;
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    for (const [tokenHash, token] of this.resetTokens) {
      if (token.userId === input.userId) this.resetTokens.delete(tokenHash);
    }
    this.resetTokens.set(input.tokenHash, {
      userId: input.userId,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
  }

  async consumePasswordResetToken(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean> {
    const token = this.resetTokens.get(input.tokenHash);
    if (!token || token.usedAt || token.expiresAt <= input.now) return false;
    token.usedAt = input.now;
    const user = [...this.users.values()].find(({ id }) => id === token.userId);
    if (!user) return false;
    user.passwordHash = input.passwordHash;
    return true;
  }

  async deletePasswordResetToken(tokenHash: string): Promise<void> {
    this.resetTokens.delete(tokenHash);
  }

  async createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }> {
    if (this.users.has(input.email)) {
      throw new DuplicateEmailError();
    }
    const user = {
      id: this.nextId("user"),
      ...input,
      isGuest: false,
      guestExpiresAt: null,
    };
    const workspace = this.addWorkspace(user.id, "Personal workspace", "OWNER");
    this.users.set(user.email, user);
    return { user, workspace };
  }

  async createGuestWorkspace(expiresAt: Date): Promise<{
    user: AuthUser;
    workspace: WorkspaceSummary;
  }> {
    const id = this.nextId("user");
    const user: AuthUser = {
      id,
      email: `guest-${id}@guest.linkpulse.invalid`,
      passwordHash: "test-guest-credential",
      isGuest: true,
      guestExpiresAt: expiresAt,
    };
    const workspace = this.addWorkspace(user.id, "Guest workspace", "OWNER");
    this.users.set(user.email, user);
    return { user, workspace };
  }

  async deleteExpiredGuestAccounts(before: Date, limit: number): Promise<number> {
    const expiredUsers = [...this.users.values()]
      .filter(
        (user) =>
          user.isGuest &&
          user.guestExpiresAt !== null &&
          user.guestExpiresAt <= before,
      )
      .slice(0, limit);
    for (const user of expiredUsers) {
      this.users.delete(user.email);
      const workspaces = this.workspaces.get(user.id) ?? [];
      this.workspaces.delete(user.id);
      for (const workspace of workspaces) {
        this.memberships.delete(`${workspace.id}:${user.id}`);
      }
    }
    return expiredUsers.length;
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

  function createApp(
    repository = new InMemoryAuthRepository(),
    passwordResetMailer?: PasswordResetMailer,
  ) {
    const app = buildApp({
      auth: {
        repository,
        passwordResetRepository: repository,
        ...(passwordResetMailer ? { passwordResetMailer } : {}),
        publicBaseUrl: "https://short.remindkro.in",
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

  it("sends a non-enumerating reset email and accepts its token once", async () => {
    const deliveries: Array<{ email: string; resetUrl: string }> = [];
    const { app } = createApp(undefined, {
      async sendPasswordReset(email, resetUrl) {
        deliveries.push({ email, resetUrl });
      },
    });
    await register(app);

    const existing = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: " USER@example.com " },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "missing@example.com" },
    });
    expect(existing.statusCode).toBe(202);
    expect(existing.json()).toEqual(missing.json());
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].email).toBe("user@example.com");

    const token = new URLSearchParams(
      new URL(deliveries[0].resetUrl).hash.slice(1),
    ).get("resetToken");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const reset = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, password: "a stronger replacement password 123" },
    });
    expect(reset.statusCode).toBe(200);

    const reused = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, password: "another replacement password 123" },
    });
    expect(reused.statusCode).toBe(400);

    const oldPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "user@example.com", password: "long enough password 123" },
    });
    const newPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "user@example.com",
        password: "a stronger replacement password 123",
      },
    });
    expect(oldPassword.statusCode).toBe(401);
    expect(newPassword.statusCode).toBe(200);
  });

  it("reports password reset as unavailable when SMTP is not configured", async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "user@example.com" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().message).toContain("not configured");
  });

  it("rejects expired password-reset tokens", async () => {
    const repository = new InMemoryAuthRepository();
    const { app } = createApp(repository);
    const account = await register(app);
    const token = "expired-reset-token".padEnd(43, "x");
    await repository.createPasswordResetToken({
      userId: account.user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() - 1),
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, password: "a fresh long password for reset 123" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("expired");
  });

  it("keeps reset requests non-enumerating when email delivery fails", async () => {
    let attemptedUrl = "";
    const { app } = createApp(undefined, {
      async sendPasswordReset(_email, resetUrl) {
        attemptedUrl = resetUrl;
        throw new Error("SMTP unavailable");
      },
    });
    await register(app);

    const response = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "user@example.com" },
    });
    const token = new URLSearchParams(new URL(attemptedUrl).hash.slice(1))
      .get("resetToken");
    const reset = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, password: "replacement password long enough 123" },
    });
    expect(response.statusCode).toBe(202);
    expect(reset.statusCode).toBe(400);
  });

  it("starts a temporary guest workspace with a scoped token and scheduled expiry", async () => {
    const { app, repository } = createApp();
    const startedAt = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/auth/guest",
    });
    const body = response.json();
    const expiresAt = new Date(body.user.guestExpiresAt);
    const headers = { authorization: `Bearer ${body.accessToken}` };

    expect(response.statusCode).toBe(201);
    expect(body.user).toMatchObject({ isGuest: true });
    expect(body.user).not.toHaveProperty("email");
    expect(body.workspace).toMatchObject({
      name: "Guest workspace",
      role: "OWNER",
    });
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + 7 * 86_400_000,
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 7 * 86_400_000,
    );

    const profile = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers,
    });
    expect(profile.json()).toMatchObject({
      id: body.user.id,
      isGuest: true,
      guestExpiresAt: body.user.guestExpiresAt,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers,
    });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({
      id: body.workspace.id,
      name: "Guest workspace",
    });

    const extraWorkspace = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers,
      payload: { name: "Another workspace" },
    });
    expect(extraWorkspace.statusCode).toBe(403);

    expect(
      await repository.deleteExpiredGuestAccounts(
        new Date(startedAt + 8 * 86_400_000),
        10,
      ),
    ).toBe(1);
    expect(await repository.listWorkspaces(body.user.id)).toEqual([]);
  });

  it("rate-limits guest workspace creation", async () => {
    const { app } = createApp();
    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await app.inject({ method: "POST", url: "/auth/guest" }));
    }
    expect(responses.slice(0, 3).map(({ statusCode }) => statusCode)).toEqual([
      201,
      201,
      201,
    ]);
    expect(responses[3].statusCode).toBe(429);
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
