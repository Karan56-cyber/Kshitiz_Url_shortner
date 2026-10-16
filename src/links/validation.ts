import { isIP } from "node:net";

export class InvalidDestinationUrlError extends Error {
  constructor() {
    super("Destination URL is not allowed");
    this.name = "InvalidDestinationUrlError";
  }
}

const blockedIpv4Ranges: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function ipv4ToNumber(hostname: string): number {
  return hostname.split(".").reduce((address, octet) => {
    return ((address << 8) | Number(octet)) >>> 0;
  }, 0);
}

function isBlockedIpv4(hostname: string): boolean {
  const address = ipv4ToNumber(hostname);
  return blockedIpv4Ranges.some(([network, prefix]) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (address & mask) === (network & mask);
  });
}

function ipv6Groups(hostname: string): number[] {
  let value = hostname.toLowerCase();
  const dottedTail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedTail) {
    const octets = dottedTail[1]!.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return [];
    const pair = `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
    value = value.slice(0, value.length - dottedTail[1]!.length) + pair;
  }

  const halves = value.split("::");
  if (halves.length > 2) return [];
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return [];
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

function isPublicIpv6(hostname: string): boolean {
  const groups = ipv6Groups(hostname);
  if (groups.length !== 8) return false;
  const first = groups[0]!;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (groups[1]! <= 0x01ff || groups[1] === 0x0db8)) {
    return false;
  }
  return first !== 0x2002;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal"
  );
}

export function validateDestinationUrl(input: string): string {
  if (
    input.length > 2048 ||
    input !== input.trim() ||
    /[\u0000-\u001f\u007f\\]/.test(input)
  ) {
    throw new InvalidDestinationUrlError();
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidDestinationUrlError();
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new InvalidDestinationUrlError();
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new InvalidDestinationUrlError();
  }

  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isBlockedIpv4(hostname)) ||
    (ipVersion === 6 && !isPublicIpv6(hostname))
  ) {
    throw new InvalidDestinationUrlError();
  }

  return url.href;
}

export function isValidAlias(alias: string): boolean {
  return /^[A-Za-z0-9_-]{3,64}$/.test(alias);
}
