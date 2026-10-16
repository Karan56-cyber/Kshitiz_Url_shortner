import { PrismaClient } from "../generated/prisma/client.js";
import {
  DuplicateAliasError,
  type CreateLinkInput,
  type LinkRecord,
  type LinkRepository,
  type UpdateLinkInput,
} from "./types.js";

function isAliasUniqueConstraintError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  if (!("meta" in error) || typeof error.meta !== "object" || error.meta === null) {
    return false;
  }
  const target = "target" in error.meta ? error.meta.target : undefined;
  return Array.isArray(target)
    ? target.includes("alias")
    : typeof target === "string" && target.includes("alias");
}

export class PrismaLinkRepository implements LinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createLink(input: CreateLinkInput): Promise<LinkRecord> {
    try {
      return await this.prisma.link.create({ data: input });
    } catch (error) {
      if (isAliasUniqueConstraintError(error)) {
        throw new DuplicateAliasError();
      }
      throw error;
    }
  }

  listLinks(workspaceId: string, limit: number): Promise<LinkRecord[]> {
    return this.prisma.link.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  findLink(workspaceId: string, linkId: string): Promise<LinkRecord | null> {
    return this.prisma.link.findFirst({
      where: { id: linkId, workspaceId },
    });
  }

  updateLink(
    workspaceId: string,
    linkId: string,
    input: UpdateLinkInput,
  ): Promise<LinkRecord | null> {
    return this.prisma.link
      .update({
        where: { id: linkId, workspaceId },
        data: input,
      })
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2025"
        ) {
          return null;
        }
        throw error;
      });
  }

  disableLink(workspaceId: string, linkId: string): Promise<LinkRecord | null> {
    return this.updateLink(workspaceId, linkId, { status: "DISABLED" });
  }

  async campaignBelongsToWorkspace(
    campaignId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true },
    });
    return campaign !== null;
  }

  findByAlias(alias: string): Promise<LinkRecord | null> {
    return this.prisma.link.findUnique({ where: { alias } });
  }

  async claimRedirect(
    alias: string,
    expectedPasswordHash: string | null,
    now: Date,
  ): Promise<LinkRecord | null> {
    const rows = await this.prisma.$queryRaw<LinkRecord[]>`
      UPDATE "links"
      SET "clickCount" = "clickCount" + 1,
          "updatedAt" = NOW()
      WHERE "alias" = ${alias}
        AND "passwordHash" IS NOT DISTINCT FROM ${expectedPasswordHash}
        AND "status" = 'ACTIVE'::"LinkStatus"
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
        AND ("maxClicks" IS NULL OR "clickCount" < "maxClicks")
      RETURNING
        "id", "workspaceId", "campaignId", "createdById", "alias",
        "destinationUrl", "status", "expiresAt", "maxClicks", "clickCount",
        "passwordHash", "createdAt", "updatedAt"
    `;
    return rows[0] ?? null;
  }
}
