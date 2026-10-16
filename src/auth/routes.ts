import { fastifyJwt } from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type Redis from "ioredis";
import { z } from "zod";
import { DuplicateEmailError } from "./errors.js";
import type { PasswordResetMailer } from "./password-reset-mailer.js";
import { hashPassword, verifyPassword } from "./password.js";
import type {
  AuthRepository,
  PasswordResetRepository,
  WorkspaceRole,
} from "./types.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { email: string; guest?: boolean; guestExpiresAt?: string };
    user: {
      email: string;
      sub: string;
      guest?: boolean;
      guestExpiresAt?: string;
    };
  }
}

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254),
});
const passwordResetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
});
const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

interface AuthOptions {
  repository: AuthRepository;
  passwordResetRepository?: PasswordResetRepository;
  passwordResetMailer?: PasswordResetMailer;
  publicBaseUrl?: string;
  jwtSecret: string;
  redis?: Redis;
}

function parseBody<T>(
  schema: z.ZodType<T>,
  request: FastifyRequest,
  reply: FastifyReply,
): T | undefined {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    void reply.code(400).send({
      error: "Bad Request",
      message: "Request validation failed",
    });
    return undefined;
  }
  return result.data;
}

function normalizedEmail(email: string): string {
  return email.toLowerCase();
}

function accessTokenPayload(
  app: FastifyInstance,
  user: { id: string; email: string },
) {
  const accessToken = app.jwt.sign(
    { email: user.email },
    { sub: user.id },
  );
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: 900,
    user: { id: user.id, email: user.email },
  };
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
  }
}

export function requireWorkspaceRole(
  repository: AuthRepository,
  allowedRoles?: readonly WorkspaceRole[],
): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user?.sub) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }
    const params = request.params as { workspaceId?: string };
    if (!params.workspaceId) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Workspace ID is required",
      });
    }

    const membership = await repository.findMembership(
      request.user.sub,
      params.workspaceId,
    );
    if (!membership) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Workspace not found",
      });
    }
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Insufficient workspace permissions",
      });
    }
  };
}

export function registerAuthentication(
  app: FastifyInstance,
  options: AuthOptions,
): void {
  const jwtOptions = {
    secret: options.jwtSecret,
    sign: { algorithm: "HS256", expiresIn: "15m", iss: "linkpulse-api" },
    verify: { algorithms: ["HS256"], allowedIss: "linkpulse-api" },
  } satisfies Parameters<typeof fastifyJwt>[1];
  app.register(
    fastifyJwt as FastifyPluginCallback<FastifyPluginOptions>,
    jwtOptions,
  );
  app.register(async (authApp) => {
    await authApp.register(rateLimit, {
      global: false,
      max: 5,
      timeWindow: "1 minute",
      ...(options.redis ? { redis: options.redis } : {}),
    });

    authApp.post(
      "/auth/register",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = parseBody(registerSchema, request, reply);
        if (!body) return;
        const email = normalizedEmail(body.email);
        try {
          const { user, workspace } =
            await options.repository.createUserWithPersonalWorkspace({
              email,
              passwordHash: await hashPassword(body.password),
            });
          return reply.code(201).send({
            ...accessTokenPayload(authApp, user),
            workspace: {
              id: workspace.id,
              name: workspace.name,
              role: workspace.role,
            },
          });
        } catch (error) {
          if (error instanceof DuplicateEmailError) {
            return reply.code(409).send({
              error: "Conflict",
              message: "An account with this email already exists",
            });
          }
          throw error;
        }
      },
    );

    authApp.post(
      "/auth/login",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = parseBody(loginSchema, request, reply);
        if (!body) return;
        const email = normalizedEmail(body.email);
        const user = await options.repository.findUserByEmail(email);
        const passwordMatches =
          user && !user.isGuest
            ? await verifyPassword(body.password, user.passwordHash)
            : false;
        if (!user || !passwordMatches) {
          return reply.code(401).send({
            error: "Unauthorized",
            message: "Invalid email or password",
          });
        }
        return reply.code(200).send(accessTokenPayload(authApp, user));
      },
    );

    authApp.post(
      "/auth/password-reset/request",
      { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } },
      async (request, reply) => {
        const body = parseBody(passwordResetRequestSchema, request, reply);
        if (!body) return;
        const resetRepository = options.passwordResetRepository;
        const resetMailer = options.passwordResetMailer;
        const publicBaseUrl = options.publicBaseUrl;
        if (!resetRepository || !resetMailer || !publicBaseUrl) {
          return reply.code(503).send({
            error: "Service Unavailable",
            message: "Password reset is not configured. Contact the site administrator.",
          });
        }

        const user = await options.repository.findUserByEmail(
          normalizedEmail(body.email),
        );
        if (user && !user.isGuest) {
          const token = randomBytes(32).toString("base64url");
          const tokenHash = createHash("sha256").update(token).digest("hex");
          await resetRepository.createPasswordResetToken({
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          });
          const resetUrl = new URL("/", publicBaseUrl);
          resetUrl.hash = new URLSearchParams({ resetToken: token }).toString();
          void Promise.resolve()
            .then(() => resetMailer.sendPasswordReset(user.email, resetUrl.toString()))
            .catch(async (error: unknown) => {
              request.log.error(
                { err: error, userId: user.id },
                "Password reset email delivery failed",
              );
              try {
                await resetRepository.deletePasswordResetToken(tokenHash);
              } catch (cleanupError) {
                request.log.error(
                  { err: cleanupError, userId: user.id },
                  "Failed to invalidate undelivered password reset token",
                );
              }
            });
        }

        return reply.code(202).send({
          message:
            "If an account exists for that email, password reset instructions have been sent.",
        });
      },
    );

    authApp.post(
      "/auth/password-reset/confirm",
      { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
      async (request, reply) => {
        const body = parseBody(passwordResetSchema, request, reply);
        if (!body) return;
        if (!options.passwordResetRepository) {
          return reply.code(503).send({
            error: "Service Unavailable",
            message: "Password reset is not configured. Contact the site administrator.",
          });
        }
        const updated = await options.passwordResetRepository
          .consumePasswordResetToken({
            tokenHash: createHash("sha256").update(body.token).digest("hex"),
            passwordHash: await hashPassword(body.password),
            now: new Date(),
          });
        if (!updated) {
          return reply.code(400).send({
            error: "Bad Request",
            message: "This reset link is invalid or expired. Request a new one.",
          });
        }
        return reply.code(200).send({
          message: "Password updated. You can now sign in with your new password.",
        });
      },
    );

    authApp.post(
      "/auth/guest",
      { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
      async (_request, reply) => {
        const retentionDays = 7;
        const guestExpiresAt = new Date(
          Date.now() + retentionDays * 86_400_000,
        );
        const { user, workspace } =
          await options.repository.createGuestWorkspace(guestExpiresAt);
        const accessToken = authApp.jwt.sign(
          {
            email: user.email,
            guest: true,
            guestExpiresAt: guestExpiresAt.toISOString(),
          },
          {
            sub: user.id,
            expiresIn: retentionDays * 86_400,
          },
        );
        return reply.code(201).send({
          accessToken,
          tokenType: "Bearer",
          expiresIn: retentionDays * 86_400,
          user: {
            id: user.id,
            isGuest: true,
            guestExpiresAt: guestExpiresAt.toISOString(),
          },
          workspace: {
            id: workspace.id,
            name: workspace.name,
            role: workspace.role,
          },
        });
      },
    );

    authApp.get("/auth/me", { preHandler: authenticate }, async (request) => ({
      id: request.user.sub,
      ...(request.user.guest
        ? {
            isGuest: true,
            guestExpiresAt: request.user.guestExpiresAt,
          }
        : { email: request.user.email }),
    }));

    authApp.get(
      "/workspaces",
      { preHandler: authenticate },
      async (request) => {
        const workspaces = await options.repository.listWorkspaces(request.user.sub);
        return workspaces.map(({ id, name, role, createdAt }) => ({
          id,
          name,
          role,
          createdAt: createdAt.toISOString(),
        }));
      },
    );

    authApp.post(
      "/workspaces",
      { preHandler: authenticate },
      async (request, reply) => {
        if (request.user.guest) {
          return reply.code(403).send({
            error: "Forbidden",
            message: "Guest workspaces cannot create additional workspaces",
          });
        }
        const body = parseBody(workspaceSchema, request, reply);
        if (!body) return;
        const workspace = await options.repository.createWorkspace(
          request.user.sub,
          body.name,
        );
        return reply.code(201).send({
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
          createdAt: workspace.createdAt.toISOString(),
        });
      },
    );
  });
}
