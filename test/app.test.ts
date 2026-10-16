import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

describe("health endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports liveness without querying dependencies", async () => {
    const app = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("does not report readiness when the database is not configured", async () => {
    const app = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not_ready" });
    await app.close();
  });
});
