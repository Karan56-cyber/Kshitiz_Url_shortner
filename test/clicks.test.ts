import { afterEach, describe, expect, it } from "vitest";
import type Redis from "ioredis";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceSummary,
} from "../src/auth/types.js";
import { createClickEvent } from "../src/clicks/event.js";
import type {
  AnalyticsRange,
  AnalyticsRepository,
  CampaignAnalytics,
  ClickEventRecord,
  ClickEventRepository,
  LinkAnalytics,
} from "../src/clicks/types.js";
import {
  CLICK_EVENT_DEAD_LETTER_STREAM,
  enqueueClickEvent,
} from "../src/clicks/queue.js";
import { ClickEventWorker } from "../src/clicks/worker.js";
import { buildApp } from "../src/app.js";

class MemoryAuthRepository implements AuthRepository {
  private sequence = 0;
  private readonly users = new Map<string, AuthUser>();
  private readonly workspaces = new Map<string, WorkspaceSummary>();
  private readonly memberships = new Map<string, WorkspaceRole>();

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.users.get(email) ?? null;
  }

  async createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }> {
    const user = { id: this.nextId("user"), ...input };
    this.users.set(input.email, user);
    const workspace = this.addWorkspace(user.id, "Personal workspace", "OWNER");
    return { user, workspace };
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return [...this.workspaces.values()].filter((workspace) =>
      this.memberships.has(`${workspace.id}:${userId}`),
    );
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
    this.workspaces.set(workspace.id, workspace);
    this.memberships.set(`${workspace.id}:${userId}`, role);
    return workspace;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

class MemoryAnalyticsRepository implements AnalyticsRepository, ClickEventRepository {
  readonly links: Array<{
    id: string;
    workspaceId: string;
    alias: string;
    status: "ACTIVE" | "DISABLED";
    campaignId: string | null;
    campaignName: string | null;
  }> = [];
  readonly events = new Map<string, ClickEventRecord>();

  async persistClickEvent(event: ClickEventRecord): Promise<void> {
    if (!this.events.has(event.id)) this.events.set(event.id, event);
  }

  async deleteClickEventsBefore(cutoff: Date, batchSize: number): Promise<number> {
    const expired = [...this.events.values()]
      .filter((event) => event.clickedAt < cutoff)
      .slice(0, batchSize);
    for (const event of expired) this.events.delete(event.id);
    return expired.length;
  }

  async getDailyClicks(range: AnalyticsRange): Promise<Array<{ date: Date; clicks: number }>> {
    const counts = new Map<string, number>();
    for (const event of this.workspaceEvents(range)) {
      if (event.isBot) continue;
      const day = new Date(event.clickedAt);
      day.setUTCHours(0, 0, 0, 0);
      const key = day.toISOString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([date, clicks]) => ({ date: new Date(date), clicks }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async getTopLinks(
    range: AnalyticsRange,
    limit: number,
    offset: number,
  ): Promise<LinkAnalytics[]> {
    return this.links
      .filter((link) => link.workspaceId === range.workspaceId)
      .map((link) => ({
        linkId: link.id,
        alias: link.alias,
        status: link.status,
        campaignId: link.campaignId,
        campaignName: link.campaignName,
        clicks: this.workspaceEvents(range).filter(
          (event) => event.linkId === link.id && !event.isBot,
        ).length,
      }))
      .sort((a, b) => b.clicks - a.clicks || a.linkId.localeCompare(b.linkId))
      .slice(offset, offset + limit);
  }

  async getCampaignClicks(range: AnalyticsRange): Promise<CampaignAnalytics[]> {
    const counts = new Map<string, { campaignName: string; clicks: number }>();
    for (const link of this.links.filter(
      (entry) => entry.workspaceId === range.workspaceId && entry.campaignId,
    )) {
      const campaignId = link.campaignId!;
      const current = counts.get(campaignId) ?? {
        campaignName: link.campaignName ?? "",
        clicks: 0,
      };
      current.clicks += this.workspaceEvents(range).filter(
        (event) => event.linkId === link.id && !event.isBot,
      ).length;
      counts.set(campaignId, current);
    }
    return [...counts.entries()].map(([campaignId, values]) => ({
      campaignId,
      ...values,
    }));
  }

  async countLinks(workspaceId: string): Promise<number> {
    return this.links.filter((link) => link.workspaceId === workspaceId).length;
  }

  private workspaceEvents(range: AnalyticsRange): ClickEventRecord[] {
    const workspaceLinkIds = new Set(
      this.links
        .filter((link) => link.workspaceId === range.workspaceId)
        .map((link) => link.id),
    );
    return [...this.events.values()].filter(
      (event) =>
        workspaceLinkIds.has(event.linkId) &&
        event.clickedAt >= range.from &&
        event.clickedAt < range.to,
    );
  }
}

function makeEvent(
  id: string,
  linkId: string,
  clickedAt: string,
  isBot = false,
): ClickEventRecord {
  return {
    id,
    linkId,
    clickedAt: new Date(clickedAt),
    referrer: null,
    userAgent: null,
    deviceType: isBot ? "BOT" : "DESKTOP",
    browser: "CHROME",
    isBot,
  };
}

describe("click event capture and analytics", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("sanitizes visitor metadata and classifies known bots without collecting IP", () => {
    const event = createClickEvent({
      id: "event-1",
      linkId: "link-1",
      workspaceId: "workspace-1",
      alias: "short",
      clickedAt: new Date("2026-10-16T00:00:00.000Z"),
      referrer: "https://referrer.example/sensitive/path?token=secret#fragment",
      userAgent: "Googlebot/2.1\u0000",
    });

    expect(event).toMatchObject({
      referrer: "https://referrer.example",
      userAgent: "Googlebot/2.1",
      deviceType: "BOT",
      isBot: true,
    });
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("ip");
  });

  it("surfaces queue publication failure instead of pretending it was durable", async () => {
    const redis = {
      xadd: async () => {
        throw new Error("redis unavailable");
      },
    } as unknown as Redis;
    const event = createClickEvent({
      id: "event-2",
      linkId: "link-1",
      workspaceId: "workspace-1",
      alias: "short",
      clickedAt: new Date(),
      referrer: undefined,
      userAgent: undefined,
    });

    await expect(enqueueClickEvent(redis, event)).rejects.toThrow("redis unavailable");
  });

  it("persists accepted bot events idempotently across duplicate deliveries", async () => {
    const event = createClickEvent({
      id: "event-duplicate",
      linkId: "link-1",
      workspaceId: "workspace-1",
      alias: "short",
      clickedAt: new Date(),
      referrer: undefined,
      userAgent: "Googlebot/2.1",
    });
    const repository = new MemoryAnalyticsRepository();
    let deliveries = 0;
    let acknowledgements = 0;
    let duplicateAcknowledged: (() => void) | undefined;
    const duplicateDone = new Promise<void>((resolve) => {
      duplicateAcknowledged = resolve;
    });
    const redis = {
      xgroup: async () => "OK",
      xautoclaim: async () => ["0-0", [], []],
      xreadgroup: async () => {
        deliveries += 1;
        if (deliveries > 2) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return null;
        }
        return [[
          "linkpulse:click-events",
          [[`${deliveries}-0`, ["payload", JSON.stringify(event)]]],
        ]];
      },
      xpending: async () => [["1-0", "worker", 0, 1]],
      xack: async () => {
        acknowledgements += 1;
        if (acknowledgements === 2) duplicateAcknowledged?.();
        return 1;
      },
      xadd: async () => "2-0",
    } as unknown as Redis;
    const worker = new ClickEventWorker({
      redis,
      repository,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      consumer: "worker-test",
    });
    const run = worker.start();

    await duplicateDone;
    await worker.stop();
    await run;

    expect(deliveries).toBe(2);
    expect(repository.events.size).toBe(1);
    expect(repository.events.get(event.id)?.isBot).toBe(true);
  });

  it("retries failed persistence and dead-letters after the configured attempt limit", async () => {
    const event = createClickEvent({
      id: "event-retry",
      linkId: "link-1",
      workspaceId: "workspace-1",
      alias: "short",
      clickedAt: new Date(),
      referrer: undefined,
      userAgent: "Mozilla/5.0 Chrome/120.0",
    });
    let deliveryCount = 0;
    let acknowledged = false;
    let deadLetterResolve: (() => void) | undefined;
    const deadLettered = new Promise<void>((resolve) => {
      deadLetterResolve = resolve;
    });
    const streamResult = [
      "0-0",
      [["1-0", ["payload", JSON.stringify(event)]]],
      [],
    ];
    const redis = {
      xgroup: async () => "OK",
      xautoclaim: async () => {
        if (acknowledged) return ["0-0", [], []];
        deliveryCount += 1;
        return streamResult;
      },
      xreadgroup: async () => null,
      xpending: async () => [["1-0", "worker", 0, deliveryCount]],
      xack: async () => {
        acknowledged = true;
        return 1;
      },
      xadd: async (stream: string) => {
        if (stream === CLICK_EVENT_DEAD_LETTER_STREAM) deadLetterResolve?.();
        return "2-0";
      },
    } as unknown as Redis;
    let persistedAttempts = 0;
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const worker = new ClickEventWorker({
      redis,
      repository: {
        persistClickEvent: async () => {
          persistedAttempts += 1;
          throw new Error("database unavailable");
        },
        deleteClickEventsBefore: async () => 0,
      },
      logger,
      consumer: "worker-test",
      maxAttempts: 3,
      visibilityTimeoutMs: 1,
    });
    const run = worker.start();

    await deadLettered;
    await worker.stop();
    await run;

    expect(persistedAttempts).toBe(3);
    expect(acknowledged).toBe(true);
  });

  it("filters bot events from workspace aggregates, bounds date ranges, and paginates links", async () => {
    const authRepository = new MemoryAuthRepository();
    const repository = new MemoryAnalyticsRepository();
    const app = buildApp({
      auth: {
        repository: authRepository,
        jwtSecret: "test-secret-that-is-at-least-thirty-two-characters",
      },
      analytics: { repository, authRepository },
      logger: false,
    });
    apps.push(app);

    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "analytics@example.com", password: "long enough password 123" },
    });
    const account = registration.json();
    const headers = { authorization: `Bearer ${account.accessToken}` };
    const secondWorkspace = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers,
      payload: { name: "Second workspace" },
    });
    const firstId = account.workspace.id as string;
    const secondId = secondWorkspace.json().id as string;

    repository.links.push(
      {
        id: "link-a",
        workspaceId: firstId,
        alias: "first",
        status: "DISABLED",
        campaignId: "campaign-a",
        campaignName: "Spring",
      },
      {
        id: "link-b",
        workspaceId: firstId,
        alias: "second",
        status: "ACTIVE",
        campaignId: null,
        campaignName: null,
      },
      {
        id: "link-foreign",
        workspaceId: secondId,
        alias: "foreign",
        status: "ACTIVE",
        campaignId: null,
        campaignName: null,
      },
    );
    repository.events.set("human-1", makeEvent(
      "human-1",
      "link-a",
      "2026-10-15T10:00:00.000Z",
    ));
    repository.events.set("human-2", makeEvent(
      "human-2",
      "link-b",
      "2026-10-15T12:00:00.000Z",
    ));
    repository.events.set("bot-1", makeEvent(
      "bot-1",
      "link-a",
      "2026-10-15T12:00:00.000Z",
      true,
    ));
    repository.events.set("foreign-1", makeEvent(
      "foreign-1",
      "link-foreign",
      "2026-10-15T12:00:00.000Z",
    ));

    const base = `/workspaces/${firstId}/analytics`;
    const overview = await app.inject({
      method: "GET",
      url: `${base}/overview?from=2026-10-15T00%3A00%3A00.000Z&to=2026-10-16T00%3A00%3A00.000Z`,
      headers,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      totalClicks: 2,
      totalLinks: 2,
      topLinks: [
        { alias: "first", clicks: 1, status: "DISABLED" },
        { alias: "second", clicks: 1 },
      ],
      campaigns: [{ campaignId: "campaign-a", clicks: 1 }],
    });

    const page = await app.inject({
      method: "GET",
      url: `${base}/links?limit=1&offset=1&from=2026-10-15T00%3A00%3A00.000Z&to=2026-10-16T00%3A00%3A00.000Z`,
      headers,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().links).toHaveLength(1);
    expect(page.json().links[0].alias).toBe("second");

    const invalidRange = await app.inject({
      method: "GET",
      url: `${base}/overview?from=2024-01-01T00%3A00%3A00.000Z&to=2026-10-16T00%3A00%3A00.000Z`,
      headers,
    });
    const invalidLimit = await app.inject({
      method: "GET",
      url: `${base}/links?limit=51`,
      headers,
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);

    const foreignAccess = await app.inject({
      method: "GET",
      url: "/workspaces/not-a-member/analytics/overview",
      headers,
    });
    const unauthenticated = await app.inject({
      method: "GET",
      url: `${base}/overview`,
    });
    expect(foreignAccess.statusCode).toBe(404);
    expect(unauthenticated.statusCode).toBe(401);
  });
});
