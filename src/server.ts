import Redis from "ioredis";
import { buildApp } from "./app.js";
import { PrismaAuthRepository } from "./auth/prisma-repository.js";
import { PrismaClickRepository } from "./clicks/prisma-repository.js";
import { enqueueClickEvent } from "./clicks/queue.js";
import { PrismaLinkRepository } from "./links/prisma-repository.js";
import { loadEnvironment } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { DemoStore } from "./demo/store.js";

async function start(): Promise<void> {
  const environment = loadEnvironment();
  if (environment.DEMO_MODE) {
    const store = new DemoStore();
    const app = buildApp({
      demoMode: true,
      isDevelopment: environment.NODE_ENV !== "production",
      database: {
        checkConnection: async () => {},
        disconnect: async () => {},
      },
      auth: {
        repository: store,
        jwtSecret: environment.JWT_SECRET,
      },
      analytics: {
        repository: store,
        authRepository: store,
      },
      links: {
        repository: store,
        authRepository: store,
        publicBaseUrl: environment.PUBLIC_BASE_URL,
        onClickAccepted: (event) => store.persistClickEvent(event),
      },
    });
    try {
      await app.listen({ host: environment.HOST, port: environment.PORT });
      app.log.warn(
        { port: environment.PORT },
        "LinkPulse is running in local demo mode; data is in-memory and resets on restart",
      );
    } catch (error) {
      app.log.error({ err: error }, "Failed to start LinkPulse demo server");
      await app.close().catch((closeError: unknown) => {
        app.log.error(
          { err: closeError },
          "Failed to close demo server after startup failure",
        );
      });
      process.exitCode = 1;
      return;
    }

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      app.log.info({ signal }, "Shutting down LinkPulse demo server");
      await app.close().catch((error: unknown) => {
        app.log.error({ err: error, signal }, "Demo server shutdown failed");
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    return;
  }

  if (!environment.DATABASE_URL || !environment.REDIS_URL) {
    throw new Error("DATABASE_URL and REDIS_URL are required outside demo mode");
  }
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const redis = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  const authRepository = new PrismaAuthRepository(prisma);
  const clickRepository = new PrismaClickRepository(prisma);
  const app = buildApp({
    isDevelopment: environment.NODE_ENV !== "production",
    database: {
      checkConnection: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      disconnect: () => prisma.$disconnect(),
    },
    auth: {
      repository: authRepository,
      jwtSecret: environment.JWT_SECRET,
      redis,
    },
    analytics: {
      repository: clickRepository,
      authRepository,
    },
    links: {
      repository: new PrismaLinkRepository(prisma),
      authRepository,
      publicBaseUrl: environment.PUBLIC_BASE_URL,
      redis,
      onClickAccepted: (event) => enqueueClickEvent(redis, event),
    },
  });

  try {
    await prisma.$connect();
    await redis.connect();
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
