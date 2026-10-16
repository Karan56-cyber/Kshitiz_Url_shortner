import { describe, expect, it } from "vitest";
import { publicShortUrl } from "../web/public-short-url.js";

describe("public short link URLs", () => {
  it("uses the branded domain on deployed and preview hosts", () => {
    expect(
      publicShortUrl("spring-launch", {
        hostname: "short.remindkro.in",
        origin: "https://short.remindkro.in",
      }),
    ).toBe("https://short.remindkro.in/spring-launch");
    expect(
      publicShortUrl("spring-launch", {
        hostname: "linkpulse-api-0w93.onrender.com",
        origin: "https://linkpulse-api-0w93.onrender.com",
      }),
    ).toBe("https://short.remindkro.in/spring-launch");
    expect(
      publicShortUrl("spring-launch", {
        hostname: "preview-linkpulse.vercel.app",
        origin: "https://preview-linkpulse.vercel.app",
      }),
    ).toBe("https://short.remindkro.in/spring-launch");
  });

  it("keeps local links on the local app origin", () => {
    expect(
      publicShortUrl("local-link", {
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:3000",
      }),
    ).toBe("http://127.0.0.1:3000/local-link");
    expect(
      publicShortUrl("local-link", {
        hostname: "localhost",
        origin: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000/local-link");
  });

  it("rejects aliases that do not match the short-link route", () => {
    expect(
      publicShortUrl("../elsewhere", {
        hostname: "short.remindkro.in",
        origin: "https://short.remindkro.in",
      }),
    ).toBeNull();
  });
});
