import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import type Redis from "ioredis";
import { registerAuthentication } from "./auth/routes.js";
import type { AuthRepository } from "./auth/types.js";
import { registerAnalyticsRoutes } from "./clicks/routes.js";
import type {
  AnalyticsRepository,
  ClickEventPayload,
} from "./clicks/types.js";
import { registerLinkRoutes } from "./links/routes.js";
import type { LinkRepository } from "./links/types.js";

export interface AppOptions {
  database?: {
    checkConnection(): Promise<void>;
    disconnect(): Promise<void>;
  };
  auth?: {
    repository: AuthRepository;
    jwtSecret: string;
    redis?: Redis;
  };
  analytics?: {
    repository: AnalyticsRepository;
    authRepository: AuthRepository;
  };
  links?: {
    repository: LinkRepository;
    authRepository: AuthRepository;
    publicBaseUrl: string;
    redis?: Redis;
    generateAlias?: () => string;
    onClickAccepted?: (event: ClickEventPayload) => void | Promise<void>;
  };
  logger?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger === false
      ? false
      : {
          redact: [
            "req.headers.authorization",
            "req.body.password",
            "req.body.passwordHash",
            "req.headers.x-link-password",
            "res.headers.authorization",
          ],
        },
  });
  const database = options.database;

  app.register(helmet);
  if (options.auth) {
    registerAuthentication(app, options.auth);
  }
  if (options.links) {
    registerLinkRoutes(app, options.links);
  }
  if (options.analytics) {
    registerAnalyticsRoutes(app, options.analytics);
  }

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    if (!database) {
      return reply.code(503).send({ status: "not_ready" });
    }

    try {
      await database.checkConnection();
      if (options.auth?.redis) {
        await options.auth.redis.ping();
      }
      return { status: "ready" };
    } catch (error) {
      app.log.error({ err: error }, "Readiness check failed");
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof Error &&
      "validation" in error &&
      Array.isArray(error.validation)
    ) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Request validation failed",
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 401
    ) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      return reply.code(429).send({
        error: "Too Many Requests",
        message: "Rate limit exceeded",
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  });

  app.addHook("onClose", async () => {
    if (database) {
      await database.disconnect();
    }
    if (options.auth?.redis) {
      if (options.auth.redis.status === "ready") {
        await options.auth.redis.quit();
      } else {
        options.auth.redis.disconnect();
      }
    }
  });

  return app;
}
