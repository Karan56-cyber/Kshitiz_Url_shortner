import type Redis from "ioredis";
import type { ClickEventPayload } from "./types.js";

export const CLICK_EVENT_STREAM = "linkpulse:click-events";
export const CLICK_EVENT_GROUP = "linkpulse:click-event-workers";
export const CLICK_EVENT_DEAD_LETTER_STREAM = "linkpulse:click-events:dead";

export async function enqueueClickEvent(
  redis: Redis,
  event: ClickEventPayload,
): Promise<void> {
  await redis.xadd(CLICK_EVENT_STREAM, "*", "payload", JSON.stringify(event));
}
