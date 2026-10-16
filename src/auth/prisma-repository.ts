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
      select: { id: true, email: true, passwordHash: true },
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
