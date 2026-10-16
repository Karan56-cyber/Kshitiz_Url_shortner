const CANONICAL_SHORT_LINK_ORIGIN = "https://short.remindkro.in";
const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export interface PageLocation {
  hostname: string;
  origin: string;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^(?:127|10|192\.168|169\.254)\./.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

export function publicShortUrl(
  alias: string,
  pageLocation: PageLocation,
): string | null {
  if (!ALIAS_PATTERN.test(alias)) return null;
  const origin = isLocalHostname(pageLocation.hostname)
    ? pageLocation.origin
    : CANONICAL_SHORT_LINK_ORIGIN;
  return new URL(encodeURIComponent(alias), `${origin.replace(/\/+$/, "")}/`).href;
}
