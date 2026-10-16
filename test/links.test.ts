import { afterEach, describe, expect, it } from "vitest";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceSummary,
} from "../src/auth/types.js";
import {
  DuplicateAliasError,
  type CreateLinkInput,
  type LinkRecord,
  type LinkRepository,
  type UpdateLinkInput,
} from "../src/links/types.js";
import { LinkService } from "../src/links/service.js";
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
    if (this.users.has(input.email)) throw new Error("Duplicate user");
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

class InMemoryLinkRepository implements LinkRepository {
  private sequence = 0;
  readonly links = new Map<string, LinkRecord>();
  readonly campaigns = new Map<string, string>();

  async createLink(input: CreateLinkInput): Promise<LinkRecord> {
    if ([...this.links.values()].some((link) => link.alias === input.alias)) {
      throw new DuplicateAliasError();
    }
    const now = new Date();
    const link: LinkRecord = {
      ...input,
      id: `link-${++this.sequence}`,
      status: "ACTIVE",
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.links.set(link.id, link);
    return link;
  }

  async listLinks(workspaceId: string, limit: number): Promise<LinkRecord[]> {
    return [...this.links.values()]
      .filter((link) => link.workspaceId === workspaceId)
      .slice(0, limit);
  }

  async findLink(workspaceId: string, linkId: string): Promise<LinkRecord | null> {
    const link = this.links.get(linkId);
    return link?.workspaceId === workspaceId ? link : null;
  }

  async updateLink(
    workspaceId: string,
    linkId: string,
    input: UpdateLinkInput,
  ): Promise<LinkRecord | null> {
    const link = await this.findLink(workspaceId, linkId);
    if (!link) return null;
    const updated = { ...link, ...input, updatedAt: new Date() };
    this.links.set(linkId, updated);
    return updated;
  }

  disableLink(workspaceId: string, linkId: string): Promise<LinkRecord | null> {
    return this.updateLink(workspaceId, linkId, { status: "DISABLED" });
  }

  async campaignBelongsToWorkspace(
    campaignId: string,
    workspaceId: string,
  ): Promise<boolean> {
    return this.campaigns.get(campaignId) === workspaceId;
  }

  async findByAlias(alias: string): Promise<LinkRecord | null> {
    return [...this.links.values()].find((link) => link.alias === alias) ?? null;
  }

  async claimRedirect(
    alias: string,
    expectedPasswordHash: string | null,
    now: Date,
  ): Promise<LinkRecord | null> {
    const link = [...this.links.values()].find((entry) => entry.alias === alias);
    if (
      !link ||
      link.passwordHash !== expectedPasswordHash ||
      link.status !== "ACTIVE" ||
      (link.expiresAt !== null && link.expiresAt <= now) ||
      (link.maxClicks !== null && link.clickCount >= link.maxClicks)
    ) {
      return null;
    }
    const updated = { ...link, clickCount: link.clickCount + 1 };
    this.links.set(link.id, updated);
    return updated;
  }
}

describe("workspace link lifecycle and redirects", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function setup() {
    const authRepository = new InMemoryAuthRepository();
    const repository = new InMemoryLinkRepository();
    const app = buildApp({
      auth: {
        repository: authRepository,
        jwtSecret: "test-secret-that-is-at-least-thirty-two-characters",
      },
      links: {
        repository,
        authRepository,
        publicBaseUrl: "https://sho.rt",
        generateAlias: () => "generated1",
      },
      logger: false,
    });
    apps.push(app);
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "links@example.com", password: "long enough password 123" },
    });
    const account = registration.json() as {
      accessToken: string;
      user: { id: string };
      workspace: { id: string };
    };
    const headers = { authorization: `Bearer ${account.accessToken}` };
    const base = `/workspaces/${account.workspace.id}/links`;
    return { app, repository, account, headers, base };
  }

  async function createLink(
    app: ReturnType<typeof buildApp>,
    base: string,
    headers: Record<string, string>,
    payload: Record<string, unknown> = {
      alias: "my-link",
      destinationUrl: "https://example.com/path",
    },
  ) {
    return app.inject({ method: "POST", url: base, headers, payload });
  }

  it("creates, lists, and gets workspace links without exposing password hashes", async () => {
    const { app, base, headers } = await setup();
    const created = await createLink(app, base, headers, {
      alias: "private-link",
      destinationUrl: "https://example.com/path",
      password: "correct horse battery staple",
      maxClicks: 4,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      alias: "private-link",
      shortUrl: "https://sho.rt/private-link",
      passwordProtected: true,
      maxClicks: 4,
      clickCount: 0,
    });
    expect(created.body).not.toContain("passwordHash");
    expect(created.body).not.toContain("correct horse battery staple");

    const listed = await app.inject({ method: "GET", url: base, headers });
    const fetched = await app.inject({
      method: "GET",
      url: `${base}/${created.json().id}`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().alias).toBe("private-link");
  });

  it("rejects unsafe destinations and invalid aliases before creating links", async () => {
    const { app, repository, base, headers } = await setup();
    const unsafeUrls = [
      "javascript:alert(1)",
      "https://user:pass@example.com/",
      "http://localhost/private",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[2001:db8::1]/",
      "https://example.com\\@127.0.0.1/",
    ];
    for (const destinationUrl of unsafeUrls) {
      const response = await createLink(app, base, headers, {
        alias: "bad-link",
        destinationUrl,
      });
      expect(response.statusCode, destinationUrl).toBe(400);
    }
    const invalidAlias = await createLink(app, base, headers, {
      alias: "../unsafe",
      destinationUrl: "https://example.com",
    });
    expect(invalidAlias.statusCode).toBe(400);
    const publicIpDestination = await createLink(app, base, headers, {
      alias: "public-ip",
      destinationUrl: "https://8.8.8.8/",
    });
    expect(publicIpDestination.statusCode).toBe(201);
    expect(await repository.listLinks("workspace-2", 100)).toHaveLength(1);
  });

  it("handles duplicate aliases as conflicts and retries generated aliases", async () => {
    const { app, repository, base, headers } = await setup();
    await createLink(app, base, headers);
    const duplicate = await createLink(app, base, headers);
    expect(duplicate.statusCode).toBe(409);

    await repository.createLink({
      workspaceId: "other-workspace",
      createdById: "other-user",
      campaignId: null,
      alias: "generated1",
      destinationUrl: "https://example.com/",
      expiresAt: null,
      maxClicks: null,
      passwordHash: null,
    });
    let generated = 0;
    const serviceRepository = repository;
    const service = new LinkService({
      repository: serviceRepository,
      generateAlias: () => (generated++ === 0 ? "generated1" : "generated2"),
    });
    const record = await service.createLink({
      workspaceId: "workspace",
      createdById: "user",
      campaignId: null,
      destinationUrl: "https://example.com",
      expiresAt: null,
      maxClicks: null,
    });
    expect(record.alias).toBe("generated2");
  });

  it("scopes link management reads and mutations to the requested workspace", async () => {
    const { app, repository, account, base, headers } = await setup();
    const created = await createLink(app, base, headers);
    const linkId = created.json().id as string;
    const otherWorkspace = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers,
      payload: { name: "Second workspace" },
    });
    const foreignBase = `/workspaces/${otherWorkspace.json().id}/links`;

    const foreignRead = await app.inject({
      method: "GET",
      url: `${foreignBase}/${linkId}`,
      headers,
    });
    const foreignUpdate = await app.inject({
      method: "PATCH",
      url: `${foreignBase}/${linkId}`,
      headers,
      payload: { destinationUrl: "https://attacker.example/" },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignUpdate.statusCode).toBe(404);
    expect((await repository.findByAlias("my-link"))?.workspaceId).toBe(
      account.workspace.id,
    );
  });

  it("updates and disables links using tenant-scoped repository operations", async () => {
    const { app, base, headers } = await setup();
    const created = await createLink(app, base, headers);
    const linkId = created.json().id as string;
    const updated = await app.inject({
      method: "PATCH",
      url: `${base}/${linkId}`,
      headers,
      payload: {
        destinationUrl: "https://new.example/path",
        maxClicks: 10,
        password: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      destinationUrl: "https://new.example/path",
      maxClicks: 10,
      passwordProtected: false,
    });

    const disabled = await app.inject({
      method: "POST",
      url: `${base}/${linkId}/disable`,
      headers,
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().status).toBe("DISABLED");
    const redirect = await app.inject({ method: "GET", url: "/my-link" });
    expect(redirect.statusCode).toBe(410);
  });

  it("rejects campaigns outside the workspace and invalid expiry or click limits", async () => {
    const { app, repository, base, headers } = await setup();
    repository.campaigns.set("foreign-campaign", "different-workspace");
    const foreignCampaign = await createLink(app, base, headers, {
      destinationUrl: "https://example.com/",
      campaignId: "foreign-campaign",
    });
    const invalidLimit = await createLink(app, base, headers, {
      destinationUrl: "https://example.com/",
      maxClicks: 0,
    });
    const invalidExpiry = await createLink(app, base, headers, {
      destinationUrl: "https://example.com/",
      expiresAt: "not-a-date",
    });
    expect(foreignCampaign.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidExpiry.statusCode).toBe(400);
  });

  it("returns not-found, expired, disabled, and click-capped redirect responses", async () => {
    const { app, repository, base, headers } = await setup();
    const unknown = await app.inject({ method: "GET", url: "/missing-link" });
    expect(unknown.statusCode).toBe(404);

    const expiredResponse = await createLink(app, base, headers, {
      alias: "expired-link",
      destinationUrl: "https://example.com/",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const expired = await app.inject({ method: "GET", url: "/expired-link" });
    expect(expiredResponse.statusCode).toBe(201);
    expect(expired.statusCode).toBe(410);

    const cappedResponse = await createLink(app, base, headers, {
      alias: "capped-link",
      destinationUrl: "https://example.com/",
      maxClicks: 1,
    });
    const cappedId = cappedResponse.json().id as string;
    const accepted = await app.inject({ method: "GET", url: "/capped-link" });
    const exhausted = await app.inject({ method: "GET", url: "/capped-link" });
    expect(accepted.statusCode).toBe(302);
    expect(accepted.headers.location).toBe("https://example.com/");
    expect(exhausted.statusCode).toBe(410);
    expect((await repository.findLink("workspace-2", cappedId))?.clickCount).toBe(1);
  });

  it("checks the password before atomically consuming a click", async () => {
    const { app, repository, base, headers } = await setup();
    await createLink(app, base, headers, {
      alias: "secret-link",
      destinationUrl: "https://example.com/private",
      maxClicks: 1,
      password: "strong link passphrase",
    });
    const missingPassword = await app.inject({
      method: "GET",
      url: "/secret-link",
    });
    const wrongPassword = await app.inject({
      method: "GET",
      url: "/secret-link",
      headers: { "x-link-password": "wrong password" },
    });
    const saved = await repository.findByAlias("secret-link");
    expect(missingPassword.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(403);
    expect(saved?.clickCount).toBe(0);

    const correctPassword = await app.inject({
      method: "GET",
      url: "/secret-link",
      headers: { "x-link-password": "strong link passphrase" },
    });
    expect(correctPassword.statusCode).toBe(302);
    expect(correctPassword.headers.location).toBe("https://example.com/private");
    expect((await repository.findByAlias("secret-link"))?.clickCount).toBe(1);
  });

  it("enforces click caps under concurrent redirects and exposes an analytics hook", async () => {
    const authRepository = new InMemoryAuthRepository();
    const repository = new InMemoryLinkRepository();
    const acceptedEvents: Array<{
      id: string;
      alias: string;
      referrer: string | null;
      userAgent: string | null;
      isBot: boolean;
    }> = [];
    const app = buildApp({
      auth: {
        repository: authRepository,
        jwtSecret: "test-secret-that-is-at-least-thirty-two-characters",
      },
      links: {
        repository,
        authRepository,
        publicBaseUrl: "https://sho.rt",
        onClickAccepted: (event) => {
          acceptedEvents.push(event);
          throw new Error("Redis unavailable");
        },
      },
      logger: false,
    });
    apps.push(app);
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "concurrent@example.com", password: "long enough password 123" },
    });
    const account = registration.json();
    const headers = { authorization: `Bearer ${account.accessToken}` };
    const created = await createLink(
      app,
      `/workspaces/${account.workspace.id}/links`,
      headers,
      {
        alias: "one-click",
        destinationUrl: "https://example.com/",
        maxClicks: 1,
      },
    );
    expect(created.statusCode).toBe(201);

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: "GET",
          url: "/one-click",
          headers: {
            referer: "https://referrer.example/path?token=private",
            "user-agent": "Googlebot/2.1",
          },
        }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 302)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 410)).toHaveLength(11);
    expect((await repository.findByAlias("one-click"))?.clickCount).toBe(1);
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]).toMatchObject({
      alias: "one-click",
      referrer: "https://referrer.example",
      userAgent: "Googlebot/2.1",
      isBot: true,
    });
    expect(acceptedEvents[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects unauthenticated link management", async () => {
    const { app, base } = await setup();
    const response = await app.inject({
      method: "GET",
      url: base,
    });
    expect(response.statusCode).toBe(401);
  });
});
