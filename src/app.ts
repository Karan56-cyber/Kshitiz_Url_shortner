import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";

export interface AppOptions {
  database?: {
    checkConnection(): Promise<void>;
    disconnect(): Promise<void>;
  };
  logger?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });
  const database = options.database;

  app.register(helmet);

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    if (!database) {
      return reply.code(503).send({ status: "not_ready" });
    }

    try {
      await database.checkConnection();
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
  });

  return app;
}
