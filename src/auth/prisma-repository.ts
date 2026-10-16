import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "../generated/prisma/client.js";
import { DuplicateEmailError } from "./errors.js";
import type {
  AuthRepository,
  AuthUser,
  WorkspaceSummary,
} from "./types.js";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isGuest: true,
        guestExpiresAt: true,
      },
    });
  }

  async createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }> {
    try {
      const result = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          memberships: {
            create: {
              role: "OWNER",
              workspace: { create: { name: "Personal workspace" } },
            },
          },
        },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          isGuest: true,
          guestExpiresAt: true,
          memberships: {
            select: {
              role: true,
              workspace: { select: { id: true, name: true, createdAt: true } },
            },
          },
        },
      });
      const membership = result.memberships[0];
      if (!membership) {
        throw new Error("Personal workspace membership was not created");
      }
      return {
        user: {
          id: result.id,
          email: result.email,
          passwordHash: result.passwordHash,
          isGuest: result.isGuest,
          guestExpiresAt: result.guestExpiresAt,
        },
        workspace: {
          ...membership.workspace,
          role: membership.role,
        },
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async createGuestWorkspace(expiresAt: Date): Promise<{
    user: AuthUser;
    workspace: WorkspaceSummary;
  }> {
    const result = await this.prisma.user.create({
      data: {
        email: `guest-${randomUUID()}@guest.linkpulse.invalid`,
        passwordHash: randomBytes(32).toString("hex"),
        isGuest: true,
        guestExpiresAt: expiresAt,
        memberships: {
          create: {
            role: "OWNER",
            workspace: { create: { name: "Guest workspace" } },
          },
        },
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isGuest: true,
        guestExpiresAt: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true, createdAt: true } },
          },
        },
      },
    });
    const membership = result.memberships[0];
    if (!membership) {
      throw new Error("Guest workspace membership was not created");
    }
    return {
      user: {
        id: result.id,
        email: result.email,
        passwordHash: result.passwordHash,
        isGuest: result.isGuest,
        guestExpiresAt: result.guestExpiresAt,
      },
      workspace: {
        ...membership.workspace,
        role: membership.role,
      },
    };
  }

  async deleteExpiredGuestAccounts(before: Date, limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error("Guest cleanup batch size must be between 1 and 10000");
    }
    return this.prisma.$transaction(async (transaction) => {
      const expiredUsers = await transaction.user.findMany({
        where: { isGuest: true, guestExpiresAt: { lte: before } },
        select: { id: true },
        orderBy: { guestExpiresAt: "asc" },
        take: limit,
      });
      if (expiredUsers.length === 0) return 0;

      const userIds = expiredUsers.map(({ id }) => id);
      const memberships = await transaction.workspaceMembership.findMany({
        where: { userId: { in: userIds } },
        select: { workspaceId: true },
      });
      const workspaceIds = [...new Set(memberships.map(({ workspaceId }) => workspaceId))];

      await transaction.link.deleteMany({
        where: { createdById: { in: userIds } },
      });
      const deleted = await transaction.user.deleteMany({
        where: {
          id: { in: userIds },
          isGuest: true,
          guestExpiresAt: { lte: before },
        },
      });

      if (workspaceIds.length > 0) {
        const remainingMemberships =
          await transaction.workspaceMembership.findMany({
            where: { workspaceId: { in: workspaceIds } },
            select: { workspaceId: true },
          });
        const occupiedWorkspaces = new Set(
          remainingMemberships.map(({ workspaceId }) => workspaceId),
        );
        const orphanedWorkspaceIds = workspaceIds.filter(
          (workspaceId) => !occupiedWorkspaces.has(workspaceId),
        );
        if (orphanedWorkspaceIds.length > 0) {
          await transaction.workspace.deleteMany({
            where: { id: { in: orphanedWorkspaceIds } },
          });
        }
      }
      return deleted.count;
    });
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: { workspace: { createdAt: "asc" } },
    });
    return memberships.map(({ role, workspace }) => ({
      ...workspace,
      role,
    }));
  }

  async createWorkspace(userId: string, name: string): Promise<WorkspaceSummary> {
    const result = await this.prisma.workspace.create({
      data: {
        name,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        memberships: {
          where: { userId },
          select: { role: true },
        },
      },
    });
    const membership = result.memberships[0];
    if (!membership) {
      throw new Error("Workspace owner membership was not created");
    }
    return {
      id: result.id,
      name: result.name,
      createdAt: result.createdAt,
      role: membership.role,
    };
  }

  findMembership(userId: string, workspaceId: string) {
    return this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
  }
}
