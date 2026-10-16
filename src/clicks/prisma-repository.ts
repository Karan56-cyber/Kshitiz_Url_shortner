import { PrismaClient } from "../generated/prisma/client.js";
import type {
  AnalyticsRange,
  AnalyticsRepository,
  CampaignAnalytics,
  ClickEventRecord,
  ClickEventRepository,
  LinkAnalytics,
} from "./types.js";

function numericCount(value: bigint | number): number {
  return Number(value);
}

export class PrismaClickRepository implements ClickEventRepository, AnalyticsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async persistClickEvent(event: ClickEventRecord): Promise<void> {
    await this.prisma.clickEvent.createMany({
      data: [event],
      skipDuplicates: true,
    });
  }

  deleteClickEventsBefore(cutoff: Date, batchSize: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "click_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "click_events"
        WHERE "clickedAt" < ${cutoff}
        ORDER BY "clickedAt"
        LIMIT ${batchSize}
      )
    `;
  }

  async getDailyClicks(
    range: AnalyticsRange,
  ): Promise<Array<{ date: Date; clicks: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ date: Date; clicks: bigint | number }>>`
      SELECT date_trunc('day', event."clickedAt") AS "date",
             COUNT(*) AS "clicks"
      FROM "click_events" AS event
      INNER JOIN "links" AS link ON link."id" = event."linkId"
      WHERE link."workspaceId" = ${range.workspaceId}
        AND event."clickedAt" >= ${range.from}
        AND event."clickedAt" < ${range.to}
        AND event."isBot" = false
      GROUP BY date_trunc('day', event."clickedAt")
      ORDER BY "date" ASC
    `;
    return rows.map((row) => ({ date: row.date, clicks: numericCount(row.clicks) }));
  }

  async getTopLinks(
    range: AnalyticsRange,
    limit: number,
    offset: number,
  ): Promise<LinkAnalytics[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      linkId: string;
      alias: string;
      status: "ACTIVE" | "DISABLED";
      campaignId: string | null;
      campaignName: string | null;
      clicks: bigint | number;
    }>>`
      SELECT link."id" AS "linkId",
             link."alias",
             link."status",
             link."campaignId",
             campaign."name" AS "campaignName",
             COUNT(event."id") AS "clicks"
      FROM "links" AS link
      LEFT JOIN "campaigns" AS campaign
        ON campaign."id" = link."campaignId"
       AND campaign."workspaceId" = link."workspaceId"
      LEFT JOIN "click_events" AS event
        ON event."linkId" = link."id"
       AND event."clickedAt" >= ${range.from}
       AND event."clickedAt" < ${range.to}
       AND event."isBot" = false
      WHERE link."workspaceId" = ${range.workspaceId}
      GROUP BY link."id", link."alias", link."status", link."campaignId",
               campaign."name", link."createdAt"
      ORDER BY "clicks" DESC, link."createdAt" DESC, link."id" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((row) => ({ ...row, clicks: numericCount(row.clicks) }));
  }

  async getCampaignClicks(range: AnalyticsRange): Promise<CampaignAnalytics[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      campaignId: string;
      campaignName: string;
      clicks: bigint | number;
    }>>`
      SELECT campaign."id" AS "campaignId",
             campaign."name" AS "campaignName",
             COUNT(event."id") AS "clicks"
      FROM "campaigns" AS campaign
      LEFT JOIN "links" AS link
        ON link."campaignId" = campaign."id"
       AND link."workspaceId" = campaign."workspaceId"
      LEFT JOIN "click_events" AS event
        ON event."linkId" = link."id"
       AND event."clickedAt" >= ${range.from}
       AND event."clickedAt" < ${range.to}
       AND event."isBot" = false
      WHERE campaign."workspaceId" = ${range.workspaceId}
      GROUP BY campaign."id", campaign."name"
      ORDER BY "clicks" DESC, campaign."name" ASC
    `;
    return rows.map((row) => ({ ...row, clicks: numericCount(row.clicks) }));
  }

  countLinks(workspaceId: string): Promise<number> {
    return this.prisma.link.count({ where: { workspaceId } });
  }
}
