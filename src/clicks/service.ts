import type {
  AnalyticsRepository,
  AnalyticsRange,
} from "./types.js";

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

export interface AnalyticsQuery {
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

export class InvalidAnalyticsRangeError extends Error {
  constructor() {
    super("Analytics range must be positive and no longer than 366 days");
    this.name = "InvalidAnalyticsRangeError";
  }
}

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async overview(workspaceId: string, query: AnalyticsQuery, now = new Date()) {
    const range = this.createRange(workspaceId, query, now);
    const [daily, topLinks, campaigns, totalLinks] = await Promise.all([
      this.repository.getDailyClicks(range),
      this.repository.getTopLinks(range, query.limit, 0),
      this.repository.getCampaignClicks(range),
      this.repository.countLinks(workspaceId),
    ]);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totalClicks: daily.reduce((total, day) => total + day.clicks, 0),
      daily,
      topLinks,
      campaigns,
      totalLinks,
    };
  }

  async links(workspaceId: string, query: AnalyticsQuery, now = new Date()) {
    const range = this.createRange(workspaceId, query, now);
    const [links, totalLinks] = await Promise.all([
      this.repository.getTopLinks(range, query.limit, query.offset),
      this.repository.countLinks(workspaceId),
    ]);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      links,
      totalLinks,
      limit: query.limit,
      offset: query.offset,
    };
  }

  private createRange(
    workspaceId: string,
    query: AnalyticsQuery,
    now: Date,
  ): AnalyticsRange {
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    const duration = to.getTime() - from.getTime();
    if (duration <= 0 || duration > MAX_RANGE_DAYS * 86_400_000) {
      throw new InvalidAnalyticsRangeError();
    }
    return { workspaceId, from, to };
  }
}
