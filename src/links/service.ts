import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  DuplicateAliasError,
  type CreateLinkInput,
  type LinkRecord,
  type LinkRepository,
  type UpdateLinkInput,
} from "./types.js";
import { isValidAlias, validateDestinationUrl } from "./validation.js";

const GENERATED_ALIAS_ATTEMPTS = 5;

export interface LinkServiceOptions {
  repository: LinkRepository;
  generateAlias?: () => string;
}

export class LinkService {
  private readonly generateAlias: () => string;

  constructor(private readonly options: LinkServiceOptions) {
    this.generateAlias =
      options.generateAlias ?? (() => randomBytes(9).toString("base64url"));
  }

  async createLink(input: {
    workspaceId: string;
    createdById: string;
    campaignId: string | null;
    alias?: string;
    destinationUrl: string;
    expiresAt: Date | null;
    maxClicks: number | null;
    password?: string;
  }): Promise<LinkRecord> {
    const destinationUrl = validateDestinationUrl(input.destinationUrl);
    if (input.alias !== undefined && !isValidAlias(input.alias)) {
      throw new InvalidLinkInputError("Alias format is invalid");
    }
    await this.validateCampaign(input.campaignId, input.workspaceId);
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : null;

    const attempts = input.alias === undefined ? GENERATED_ALIAS_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const alias = input.alias ?? this.generateAlias();
      if (!isValidAlias(alias)) {
        throw new InvalidLinkInputError("Generated alias format is invalid");
      }
      try {
        return await this.options.repository.createLink({
          workspaceId: input.workspaceId,
          createdById: input.createdById,
          campaignId: input.campaignId,
          alias,
          destinationUrl,
          expiresAt: input.expiresAt,
          maxClicks: input.maxClicks,
          passwordHash,
        });
      } catch (error) {
        if (!(error instanceof DuplicateAliasError)) throw error;
        if (input.alias !== undefined) throw error;
      }
    }
    throw new AliasGenerationError();
  }

  async updateLink(
    workspaceId: string,
    linkId: string,
    input: {
      campaignId?: string | null;
      destinationUrl?: string;
      status?: "ACTIVE" | "DISABLED";
      expiresAt?: Date | null;
      maxClicks?: number | null;
      password?: string | null;
    },
  ): Promise<LinkRecord | null> {
    const update: UpdateLinkInput = {};
    if (input.campaignId !== undefined) {
      await this.validateCampaign(input.campaignId, workspaceId);
      update.campaignId = input.campaignId;
    }
    if (input.destinationUrl !== undefined) {
      update.destinationUrl = validateDestinationUrl(input.destinationUrl);
    }
    if (input.status !== undefined) update.status = input.status;
    if (input.expiresAt !== undefined) update.expiresAt = input.expiresAt;
    if (input.maxClicks !== undefined) update.maxClicks = input.maxClicks;
    if (input.password !== undefined) {
      update.passwordHash = input.password ? await hashPassword(input.password) : null;
    }
    return this.options.repository.updateLink(workspaceId, linkId, update);
  }

  async verifyPassword(password: string, hash: string | null): Promise<boolean> {
    return verifyPassword(password, hash ?? undefined);
  }

  private async validateCampaign(
    campaignId: string | null,
    workspaceId: string,
  ): Promise<void> {
    if (
      campaignId !== null &&
      !(await this.options.repository.campaignBelongsToWorkspace(
        campaignId,
        workspaceId,
      ))
    ) {
      throw new InvalidLinkInputError("Campaign not found in this workspace");
    }
  }
}

export class InvalidLinkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLinkInputError";
  }
}

export class AliasGenerationError extends Error {
  constructor() {
    super("A unique alias could not be generated");
    this.name = "AliasGenerationError";
  }
}
