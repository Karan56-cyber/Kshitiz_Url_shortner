import { buildApp } from "./app.js";
import { loadEnvironment } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";

async function start(): Promise<void> {
  const environment = loadEnvironment();
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const app = buildApp({
    database: {
      checkConnection: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      disconnect: () => prisma.$disconnect(),
    },
  });

  try {
    await prisma.$connect();
    await app.listen({ host: environment.HOST, port: environment.PORT });
  } catch (error) {
    app.log.error({ err: error }, "Failed to start LinkPulse API");
    await app.close().catch((closeError: unknown) => {
      app.log.error({ err: closeError }, "Failed to close API during startup failure");
    });
    process.exitCode = 1;
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "Shutting down LinkPulse API");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error, signal }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void start();
