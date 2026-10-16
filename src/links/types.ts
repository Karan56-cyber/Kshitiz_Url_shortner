export type LinkStatus = "ACTIVE" | "DISABLED";

export interface LinkRecord {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  createdById: string;
  alias: string;
  destinationUrl: string;
  status: LinkStatus;
  expiresAt: Date | null;
  maxClicks: number | null;
  clickCount: number;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLinkInput {
  workspaceId: string;
  createdById: string;
  campaignId: string | null;
  alias: string;
  destinationUrl: string;
  expiresAt: Date | null;
  maxClicks: number | null;
  passwordHash: string | null;
}

export interface UpdateLinkInput {
  campaignId?: string | null;
  destinationUrl?: string;
  status?: LinkStatus;
  expiresAt?: Date | null;
  maxClicks?: number | null;
  passwordHash?: string | null;
}

export interface LinkRepository {
  createLink(input: CreateLinkInput): Promise<LinkRecord>;
  listLinks(workspaceId: string, limit: number): Promise<LinkRecord[]>;
  findLink(workspaceId: string, linkId: string): Promise<LinkRecord | null>;
  updateLink(
    workspaceId: string,
    linkId: string,
    input: UpdateLinkInput,
  ): Promise<LinkRecord | null>;
  disableLink(workspaceId: string, linkId: string): Promise<LinkRecord | null>;
  campaignBelongsToWorkspace(
    campaignId: string,
    workspaceId: string,
  ): Promise<boolean>;
  findByAlias(alias: string): Promise<LinkRecord | null>;
  claimRedirect(
    alias: string,
    expectedPasswordHash: string | null,
    now: Date,
  ): Promise<LinkRecord | null>;
}

export class DuplicateAliasError extends Error {
  constructor() {
    super("The alias is already in use");
    this.name = "DuplicateAliasError";
  }
}
