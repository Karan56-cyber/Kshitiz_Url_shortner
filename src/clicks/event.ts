import type {
  ClickBrowser,
  ClickDeviceType,
  ClickEventPayload,
} from "./types.js";

const BOT_USER_AGENT =
  /bot|crawler|spider|slurp|preview|headless|monitor|checker|fetcher|curl|wget|python-requests|httpclient/i;

function sanitizeUserAgent(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512);
  return sanitized.length > 0 ? sanitized : null;
}

function sanitizeReferrer(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.slice(0, 512);
  } catch {
    return null;
  }
}

function classifyDevice(userAgent: string | null, isBot: boolean): ClickDeviceType {
  if (isBot) return "BOT";
  if (!userAgent) return "UNKNOWN";
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return "TABLET";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "MOBILE";
  return "DESKTOP";
}

function classifyBrowser(userAgent: string | null): ClickBrowser {
  if (!userAgent) return "UNKNOWN";
  if (/edg\//i.test(userAgent)) return "EDGE";
  if (/opr\/|opera/i.test(userAgent)) return "OPERA";
  if (/firefox\//i.test(userAgent)) return "FIREFOX";
  if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) return "CHROME";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return "SAFARI";
  return "OTHER";
}

export function createClickEvent(input: {
  id: string;
  linkId: string;
  workspaceId: string;
  alias: string;
  clickedAt: Date;
  referrer: string | string[] | undefined;
  userAgent: string | string[] | undefined;
}): ClickEventPayload {
  const userAgent = sanitizeUserAgent(input.userAgent);
  const isBot = userAgent !== null && BOT_USER_AGENT.test(userAgent);
  return {
    id: input.id,
    linkId: input.linkId,
    workspaceId: input.workspaceId,
    alias: input.alias,
    clickedAt: input.clickedAt.toISOString(),
    referrer: sanitizeReferrer(input.referrer),
    userAgent,
    deviceType: classifyDevice(userAgent, isBot),
    browser: classifyBrowser(userAgent),
    isBot,
  };
}
