import type Redis from "ioredis";
import type {
  ClickEventPayload,
  ClickEventRecord,
  ClickEventRepository,
} from "./types.js";
import {
  CLICK_EVENT_DEAD_LETTER_STREAM,
  CLICK_EVENT_GROUP,
  CLICK_EVENT_STREAM,
} from "./queue.js";

type StreamMessage = { id: string; fields: string[] };

interface ClickWorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface ClickEventWorkerOptions {
  redis: Redis;
  repository: ClickEventRepository;
  logger: ClickWorkerLogger;
  consumer: string;
  concurrency?: number;
  maxAttempts?: number;
  visibilityTimeoutMs?: number;
  retentionDays?: number;
  retentionBatchSize?: number;
}

function asMessages(value: unknown): StreamMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((stream) => {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) return [];
    return stream[1].flatMap((entry: unknown) => {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !Array.isArray(entry[1]) ||
        !entry[1].every((field: unknown) => typeof field === "string")
      ) {
        return [];
      }
      return [{ id: entry[0], fields: entry[1] as string[] }];
    });
  });
}

function field(fields: string[], key: string): string | undefined {
  const index = fields.indexOf(key);
  return index >= 0 ? fields[index + 1] : undefined;
}

function parseEvent(value: string | undefined): ClickEventRecord | null {
  if (!value) return null;
  try {
    const event = JSON.parse(value) as ClickEventPayload;
    if (
      typeof event.id !== "string" ||
      typeof event.linkId !== "string" ||
      typeof event.clickedAt !== "string" ||
      !Number.isFinite(Date.parse(event.clickedAt)) ||
      typeof event.isBot !== "boolean" ||
      !["BOT", "DESKTOP", "MOBILE", "TABLET", "UNKNOWN"].includes(event.deviceType) ||
      !["CHROME", "EDGE", "FIREFOX", "OPERA", "OTHER", "SAFARI", "UNKNOWN"].includes(event.browser)
    ) {
      return null;
    }
    return {
      id: event.id,
      linkId: event.linkId,
      clickedAt: new Date(event.clickedAt),
      referrer: typeof event.referrer === "string" ? event.referrer.slice(0, 512) : null,
      userAgent: typeof event.userAgent === "string" ? event.userAgent.slice(0, 512) : null,
      deviceType: event.deviceType,
      browser: event.browser,
      isBot: event.isBot,
    };
  } catch {
    return null;
  }
}

export class ClickEventWorker {
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly visibilityTimeoutMs: number;
  private readonly retentionDays: number;
  private readonly retentionBatchSize: number;
  private stopped = false;
  private runPromise: Promise<void> | null = null;
  private nextRetentionAt = 0;

  constructor(private readonly options: ClickEventWorkerOptions) {
    this.concurrency = options.concurrency ?? 10;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.visibilityTimeoutMs = options.visibilityTimeoutMs ?? 60_000;
    this.retentionDays = options.retentionDays ?? 90;
    this.retentionBatchSize = options.retentionBatchSize ?? 10_000;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 100) {
      throw new Error("Click worker concurrency must be between 1 and 100");
    }
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 20) {
      throw new Error("Click worker maxAttempts must be between 1 and 20");
    }
    if (!Number.isInteger(this.retentionDays) || this.retentionDays < 1) {
      throw new Error("Click event retention must be at least one day");
    }
  }

  async start(): Promise<void> {
    if (this.runPromise) throw new Error("Click event worker is already running");
    this.stopped = false;
    this.runPromise = this.run();
    await this.runPromise;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.runPromise;
    this.runPromise = null;
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.options.redis.xgroup(
        "CREATE",
        CLICK_EVENT_STREAM,
        CLICK_EVENT_GROUP,
        "0",
        "MKSTREAM",
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  private async run(): Promise<void> {
    await this.ensureConsumerGroup();
    await this.consume();
  }

  private async consume(): Promise<void> {
    this.options.logger.info(
      { concurrency: this.concurrency, retentionDays: this.retentionDays },
      "Click event worker started",
    );
    while (!this.stopped) {
      await this.pruneExpiredEventsIfDue();
      const reclaimed = await this.claimStaleMessages();
      const messages = reclaimed.length > 0 ? reclaimed : await this.readNewMessages();
      if (messages.length === 0) continue;
      await Promise.all(
        messages.slice(0, this.concurrency).map((message) => this.process(message)),
      );
    }
    this.options.logger.info({}, "Click event worker stopped");
  }

  private async claimStaleMessages(): Promise<StreamMessage[]> {
    const result = await this.options.redis.xautoclaim(
      CLICK_EVENT_STREAM,
      CLICK_EVENT_GROUP,
      this.options.consumer,
      String(this.visibilityTimeoutMs),
      "0-0",
      "COUNT",
      String(this.concurrency),
    );
    return Array.isArray(result)
      ? asMessages([[CLICK_EVENT_STREAM, result[1]]])
      : [];
  }

  private async readNewMessages(): Promise<StreamMessage[]> {
    const result = await this.options.redis.xreadgroup(
      "GROUP",
      CLICK_EVENT_GROUP,
      this.options.consumer,
      "COUNT",
      String(this.concurrency),
      "BLOCK",
      "1000",
      "STREAMS",
      CLICK_EVENT_STREAM,
      ">",
    );
    return asMessages(result);
  }

  private async process(message: StreamMessage): Promise<void> {
    const event = parseEvent(field(message.fields, "payload"));
    if (!event) {
      this.options.logger.warn(
        { streamMessageId: message.id },
        "Discarding malformed click event",
      );
      await this.options.redis.xack(
        CLICK_EVENT_STREAM,
        CLICK_EVENT_GROUP,
        message.id,
      );
      return;
    }

    const pending = await this.options.redis.xpending(
      CLICK_EVENT_STREAM,
      CLICK_EVENT_GROUP,
      message.id,
      message.id,
      "1",
    );
    const pendingEntry = Array.isArray(pending) ? pending[0] : undefined;
    const deliveryCount =
      Array.isArray(pendingEntry) && typeof pendingEntry[3] === "number"
        ? pendingEntry[3]
        : 1;

    try {
      await this.options.repository.persistClickEvent(event);
      await this.options.redis.xack(
        CLICK_EVENT_STREAM,
        CLICK_EVENT_GROUP,
        message.id,
      );
      this.options.logger.info(
        {
          event: "click_event_persisted",
          eventId: event.id,
          linkId: event.linkId,
          isBot: event.isBot,
        },
        "Click event persisted",
      );
    } catch (error) {
      if (deliveryCount >= this.maxAttempts) {
        await this.moveToDeadLetter(message, event, deliveryCount);
        this.options.logger.error(
          {
            err: error,
            event: "click_event_dead_lettered",
            eventId: event.id,
            linkId: event.linkId,
            attempts: deliveryCount,
          },
          "Click event moved to dead-letter stream after repeated failure",
        );
        return;
      }
      this.options.logger.warn(
        {
          err: error,
          event: "click_event_retry",
          eventId: event.id,
          linkId: event.linkId,
          attempt: deliveryCount,
          maxAttempts: this.maxAttempts,
        },
        "Click event persistence failed; message remains pending for retry",
      );
    }
  }

  private async moveToDeadLetter(
    message: StreamMessage,
    event: ClickEventRecord,
    attempts: number,
  ): Promise<void> {
    await this.options.redis.xadd(
      CLICK_EVENT_DEAD_LETTER_STREAM,
      "*",
      "eventId",
      event.id,
      "linkId",
      event.linkId,
      "attempts",
      String(attempts),
      "payload",
      field(message.fields, "payload") ?? "",
    );
    await this.options.redis.xack(
      CLICK_EVENT_STREAM,
      CLICK_EVENT_GROUP,
      message.id,
    );
  }

  private async pruneExpiredEventsIfDue(): Promise<void> {
    if (Date.now() < this.nextRetentionAt) return;
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    let deleted = 0;
    try {
      while (true) {
        const batch = await this.options.repository.deleteClickEventsBefore(
          cutoff,
          this.retentionBatchSize,
        );
        deleted += batch;
        if (batch < this.retentionBatchSize) break;
      }
    } catch (error) {
      this.options.logger.error({ err: error }, "Click event retention cleanup failed");
    }
    this.nextRetentionAt = Date.now() + 60 * 60 * 1000;
    if (deleted > 0) {
      this.options.logger.info(
        { deleted, retentionDays: this.retentionDays },
        "Expired click events removed",
      );
    }
  }
}
