import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import Redis from "ioredis";
import { PrismaAuthRepository } from "./auth/prisma-repository.js";
import { loadEnvironment } from "./config/env.js";
import { PrismaClickRepository } from "./clicks/prisma-repository.js";
import { ClickEventWorker } from "./clicks/worker.js";
import { createPrismaClient } from "./lib/prisma.js";

function log(
  level: "info" | "warn" | "error",
  fields: Record<string, unknown>,
  message: string,
): void {
  const error = fields.err;
  const normalizedFields =
    error instanceof Error
      ? { ...fields, err: { name: error.name, message: error.message } }
      : fields;
  console[level](JSON.stringify({ level, message, ...normalizedFields }));
}

async function startWorker(): Promise<void> {
  const environment = loadEnvironment();
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const redis = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  const authRepository = new PrismaAuthRepository(prisma);
  const worker = new ClickEventWorker({
    redis,
    repository: new PrismaClickRepository(prisma),
    maintenance: () =>
      authRepository.deleteExpiredGuestAccounts(new Date(), 1_000),
    logger: {
      info: (fields, message) => log("info", fields, message),
      warn: (fields, message) => log("warn", fields, message),
      error: (fields, message) => log("error", fields, message),
    },
    consumer: `${hostname()}-${process.pid}-${randomUUID()}`,
    retentionDays: environment.CLICK_EVENT_RETENTION_DAYS,
  });
  let stopRequested = false;
  let workerStarted = false;
  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (stopRequested) return;
    stopRequested = true;
    log("info", { signal }, "Shutting down click event worker");
    if (workerStarted) {
      void worker.stop().catch((error: unknown) => {
        log("error", { err: error, signal }, "Click event worker shutdown failed");
        process.exitCode = 1;
      });
    }
  };
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  try {
    await prisma.$connect();
    if (stopRequested) return;
    await redis.connect();
    if (stopRequested) return;
    workerStarted = true;
    await worker.start();
  } catch (error) {
    log("error", { err: error }, "Click event worker failed");
    process.exitCode = 1;
  } finally {
    if (workerStarted) {
      await worker.stop().catch((error: unknown) => {
        log("error", { err: error }, "Failed to stop click event worker");
        process.exitCode = 1;
      });
    }
    if (redis.status === "ready") {
      await redis.quit().catch((error: unknown) => {
        log("error", { err: error }, "Failed to close worker Redis connection");
        process.exitCode = 1;
      });
    } else {
      redis.disconnect();
    }
    await prisma.$disconnect().catch((error: unknown) => {
      log("error", { err: error }, "Failed to disconnect worker database");
      process.exitCode = 1;
    });
  }
}

void startWorker();
