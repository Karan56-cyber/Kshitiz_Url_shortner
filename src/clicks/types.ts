export type ClickDeviceType =
  | "BOT"
  | "DESKTOP"
  | "MOBILE"
  | "TABLET"
  | "UNKNOWN";

export type ClickBrowser =
  | "CHROME"
  | "EDGE"
  | "FIREFOX"
  | "OPERA"
  | "OTHER"
  | "SAFARI"
  | "UNKNOWN";

export interface ClickEventPayload {
  id: string;
  linkId: string;
  workspaceId: string;
  alias: string;
  clickedAt: string;
  referrer: string | null;
  userAgent: string | null;
  deviceType: ClickDeviceType;
  browser: ClickBrowser;
  isBot: boolean;
}

export interface ClickEventRecord {
  id: string;
  linkId: string;
  clickedAt: Date;
  referrer: string | null;
  userAgent: string | null;
  deviceType: ClickDeviceType;
  browser: ClickBrowser;
  isBot: boolean;
}

export interface ClickEventRepository {
  persistClickEvent(event: ClickEventRecord): Promise<void>;
  deleteClickEventsBefore(cutoff: Date, batchSize: number): Promise<number>;
}

export interface AnalyticsRange {
  workspaceId: string;
  from: Date;
  to: Date;
}

export interface LinkAnalytics {
  linkId: string;
  alias: string;
  status: "ACTIVE" | "DISABLED";
  campaignId: string | null;
  campaignName: string | null;
  clicks: number;
}

export interface CampaignAnalytics {
  campaignId: string;
  campaignName: string;
  clicks: number;
}

export interface AnalyticsRepository {
  getDailyClicks(range: AnalyticsRange): Promise<Array<{ date: Date; clicks: number }>>;
  getTopLinks(
    range: AnalyticsRange,
    limit: number,
    offset: number,
  ): Promise<LinkAnalytics[]>;
  getCampaignClicks(range: AnalyticsRange): Promise<CampaignAnalytics[]>;
  countLinks(workspaceId: string): Promise<number>;
}
