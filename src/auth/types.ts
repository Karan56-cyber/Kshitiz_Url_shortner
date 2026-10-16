export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  isGuest: boolean;
  guestExpiresAt: Date | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export interface WorkspaceMembership {
  role: WorkspaceRole;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createUserWithPersonalWorkspace(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ user: AuthUser; workspace: WorkspaceSummary }>;
  createGuestWorkspace(expiresAt: Date): Promise<{
    user: AuthUser;
    workspace: WorkspaceSummary;
  }>;
  deleteExpiredGuestAccounts(before: Date, limit: number): Promise<number>;
  listWorkspaces(userId: string): Promise<WorkspaceSummary[]>;
  createWorkspace(userId: string, name: string): Promise<WorkspaceSummary>;
  findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembership | null>;
}

export interface PasswordResetRepository {
  createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumePasswordResetToken(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean>;
  deletePasswordResetToken(tokenHash: string): Promise<void>;
}
