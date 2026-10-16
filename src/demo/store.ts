import { randomUUID } from "node:crypto";
import { DuplicateEmailError } from "../auth/errors.js";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceMembership,
  WorkspaceSummary,
} from "../auth/types.js";
import type {
  AnalyticsRange,
  AnalyticsRepository,
  CampaignAnalytics,
  ClickEventPayload,
  ClickEventRecord,
  ClickEventRepository,
  LinkAnalytics,
} from "../clicks/types.js";
import {
  DuplicateAliasError,
  type CreateLinkInput,
  type LinkRecord,
  type LinkRepository,
  type UpdateLinkInput,
} from "../links/types.js";

export class DemoStore
  implements
    AuthRepository,
    LinkRepository,
    AnalyticsRepository,
    ClickEventRepository
{
  private readonly users = new Map<string, AuthUser>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly workspaces = new Map<string, WorkspaceSummary>();
  private readonly memberships = new Map<string, WorkspaceMembership>();
  private readonly links = new Map<string, LinkRecord>();
  private readonly linksByAlias = new Map<string, string>();
  private readonly events = new Map<string, ClickEventRecord>();
  private readonly campaigns = new Map<string, { workspaceId: string; name: string }>();

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const userId = this.usersByEmail.get(email);
    return userId ? this.users.get(userId) ?? null : null;
  }

  async createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }> {
    if (this.usersByEmail.has(input.email)) throw new DuplicateEmailError();
    const user: AuthUser = {
      id: randomUUID(),
      ...input,
      isGuest: false,
      guestExpiresAt: null,
    };
    const workspace = this.addWorkspace(user.id, "Personal workspace");
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    return { user, workspace };
  }

  async createGuestWorkspace(expiresAt: Date): Promise<{
    user: AuthUser;
    workspace: WorkspaceSummary;
  }> {
    const user: AuthUser = {
      id: randomUUID(),
      email: `guest-${randomUUID()}@guest.linkpulse.invalid`,
      passwordHash: randomUUID(),
      isGuest: true,
      guestExpiresAt: expiresAt,
    };
    const workspace = this.addWorkspace(user.id, "Guest workspace");
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    return { user, workspace };
  }

  async deleteExpiredGuestAccounts(before: Date, limit: number): Promise<number> {
    const expired = [...this.users.values()]
      .filter(
        (user) =>
          user.isGuest &&
          user.guestExpiresAt !== null &&
          user.guestExpiresAt <= before,
      )
      .slice(0, limit);
    for (const user of expired) {
      this.users.delete(user.id);
      this.usersByEmail.delete(user.email);
      for (const [workspaceId, workspace] of this.workspaces) {
        if (this.memberships.has(`${workspaceId}:${user.id}`)) {
          this.memberships.delete(`${workspaceId}:${user.id}`);
          this.workspaces.delete(workspaceId);
        }
      }
      for (const link of this.links.values()) {
        if (link.createdById === user.id) this.deleteLink(link);
      }
    }
    return expired.length;
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return [...this.workspaces.values()].filter((workspace) =>
      this.memberships.has(`${workspace.id}:${userId}`),
    );
  }

  async createWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
    return this.addWorkspace(userId, name);
  }

  async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembership | null> {
    return this.memberships.get(`${workspaceId}:${userId}`) ?? null;
  }

  async createLink(input: CreateLinkInput): Promise<LinkRecord> {
    if (this.linksByAlias.has(input.alias)) throw new DuplicateAliasError();
    const now = new Date();
    const link: LinkRecord = {
      ...input,
      id: randomUUID(),
      status: "ACTIVE",
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.links.set(link.id, link);
    this.linksByAlias.set(link.alias, link.id);
    return link;
  }

  async listLinks(workspaceId: string, limit: number): Promise<LinkRecord[]> {
    return [...this.links.values()]
      .filter((link) => link.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
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

  async disableLink(workspaceId: string, linkId: string): Promise<LinkRecord | null> {
    return this.updateLink(workspaceId, linkId, { status: "DISABLED" });
  }

  async campaignBelongsToWorkspace(
    campaignId: string,
    workspaceId: string,
  ): Promise<boolean> {
    return this.campaigns.get(campaignId)?.workspaceId === workspaceId;
  }

  async findByAlias(alias: string): Promise<LinkRecord | null> {
    const linkId = this.linksByAlias.get(alias);
    return linkId ? this.links.get(linkId) ?? null : null;
  }

  async claimRedirect(
    alias: string,
    expectedPasswordHash: string | null,
    now: Date,
  ): Promise<LinkRecord | null> {
    const link = await this.findByAlias(alias);
    if (
      !link ||
      link.passwordHash !== expectedPasswordHash ||
      link.status !== "ACTIVE" ||
      (link.expiresAt !== null && link.expiresAt <= now) ||
      (link.maxClicks !== null && link.clickCount >= link.maxClicks)
    ) {
      return null;
    }
    const updated = { ...link, clickCount: link.clickCount + 1, updatedAt: now };
    this.links.set(link.id, updated);
    return updated;
  }

  async persistClickEvent(event: ClickEventPayload | ClickEventRecord): Promise<void> {
    if (this.events.has(event.id)) return;
    this.events.set(event.id, {
      id: event.id,
      linkId: event.linkId,
      clickedAt:
        event.clickedAt instanceof Date
          ? event.clickedAt
          : new Date(event.clickedAt),
      referrer: event.referrer,
      userAgent: event.userAgent,
      deviceType: event.deviceType,
      browser: event.browser,
      isBot: event.isBot,
    });
  }

  async deleteClickEventsBefore(cutoff: Date, batchSize: number): Promise<number> {
    const expired = [...this.events.values()]
      .filter((event) => event.clickedAt < cutoff)
      .sort((left, right) => left.clickedAt.getTime() - right.clickedAt.getTime())
      .slice(0, batchSize);
    for (const event of expired) this.events.delete(event.id);
    return expired.length;
  }

  async getDailyClicks(
    range: AnalyticsRange,
  ): Promise<Array<{ date: Date; clicks: number }>> {
    const daily = new Map<string, number>();
    for (const event of this.eventsInRange(range)) {
      const day = new Date(event.clickedAt);
      day.setUTCHours(0, 0, 0, 0);
      const key = day.toISOString();
      daily.set(key, (daily.get(key) ?? 0) + 1);
    }
    return [...daily]
      .map(([date, clicks]) => ({ date: new Date(date), clicks }))
      .sort((left, right) => left.date.getTime() - right.date.getTime());
  }

  async getTopLinks(
    range: AnalyticsRange,
    limit: number,
    offset: number,
  ): Promise<LinkAnalytics[]> {
    const clickCounts = new Map<string, number>();
    for (const event of this.eventsInRange(range)) {
      clickCounts.set(event.linkId, (clickCounts.get(event.linkId) ?? 0) + 1);
    }
    return [...this.links.values()]
      .filter((link) => link.workspaceId === range.workspaceId)
      .map((link) => {
        const campaign = link.campaignId
          ? this.campaigns.get(link.campaignId)
          : undefined;
        return {
          linkId: link.id,
          alias: link.alias,
          status: link.status,
          campaignId: link.campaignId,
          campaignName: campaign?.name ?? null,
          clicks: clickCounts.get(link.id) ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.clicks - left.clicks ||
          (this.links.get(right.linkId)?.createdAt.getTime() ?? 0) -
            (this.links.get(left.linkId)?.createdAt.getTime() ?? 0) ||
          left.linkId.localeCompare(right.linkId),
      )
      .slice(offset, offset + limit);
  }

  async getCampaignClicks(range: AnalyticsRange): Promise<CampaignAnalytics[]> {
    const clicks = new Map<string, number>();
    for (const event of this.eventsInRange(range)) {
      const link = this.links.get(event.linkId);
      if (link?.campaignId) {
        clicks.set(link.campaignId, (clicks.get(link.campaignId) ?? 0) + 1);
      }
    }
    return [...this.campaigns]
      .filter(([, campaign]) => campaign.workspaceId === range.workspaceId)
      .map(([campaignId, campaign]) => ({
        campaignId,
        campaignName: campaign.name,
        clicks: clicks.get(campaignId) ?? 0,
      }))
      .sort((left, right) => right.clicks - left.clicks);
  }

  async countLinks(workspaceId: string): Promise<number> {
    return [...this.links.values()].filter(
      (link) => link.workspaceId === workspaceId,
    ).length;
  }

  private addWorkspace(userId: string, name: string): WorkspaceSummary {
    const workspace: WorkspaceSummary = {
      id: randomUUID(),
      name,
      role: "OWNER",
      createdAt: new Date(),
    };
    this.workspaces.set(workspace.id, workspace);
    this.memberships.set(`${workspace.id}:${userId}`, { role: "OWNER" });
    return workspace;
  }

  private eventsInRange(range: AnalyticsRange): ClickEventRecord[] {
    const workspaceLinkIds = new Set(
      [...this.links.values()]
        .filter((link) => link.workspaceId === range.workspaceId)
        .map((link) => link.id),
    );
    return [...this.events.values()].filter(
      (event) =>
        workspaceLinkIds.has(event.linkId) &&
        !event.isBot &&
        event.clickedAt >= range.from &&
        event.clickedAt < range.to,
    );
  }

  private deleteLink(link: LinkRecord): void {
    this.links.delete(link.id);
    this.linksByAlias.delete(link.alias);
    for (const [eventId, event] of this.events) {
      if (event.linkId === link.id) this.events.delete(eventId);
    }
  }
}
