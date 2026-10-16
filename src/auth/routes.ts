import { fastifyJwt } from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
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
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthRepository, WorkspaceRole } from "./types.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { email: string };
    user: { email: string; sub: string };
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
const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

interface AuthOptions {
  repository: AuthRepository;
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
        const passwordMatches = await verifyPassword(
          body.password,
          user?.passwordHash,
        );
        if (!user || !passwordMatches) {
          return reply.code(401).send({
            error: "Unauthorized",
            message: "Invalid email or password",
          });
        }
        return reply.code(200).send(accessTokenPayload(authApp, user));
      },
    );

    authApp.get("/auth/me", { preHandler: authenticate }, async (request) => ({
      id: request.user.sub,
      email: request.user.email,
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
