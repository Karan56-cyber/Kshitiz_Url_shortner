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

  it("serves the login page, styles, and supplied Rive animation", async () => {
    const app = buildApp({ logger: false });

    const [page, styles, animation] = await Promise.all([
      app.inject({ method: "GET", url: "/" }),
      app.inject({ method: "GET", url: "/app.css" }),
      app.inject({ method: "GET", url: "/assets/login.riv" }),
    ]);

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain('id="auth-view"');
    expect(page.body).toMatch(/id="auth-password"[\s\S]*?minlength="1"/);
    expect(page.body).toContain('id="forgot-password"');
    expect(page.body).toContain('id="reset-password-confirm"');
    expect(page.body).toContain('id="created-link-result"');
    expect(page.body).toContain('id="copy-created-link"');
    expect(page.body).toContain('src="/app.js"');
    expect(page.headers["content-security-policy"]).toContain("'wasm-unsafe-eval'");
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(page.headers["content-security-policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(page.headers["strict-transport-security"]).toBeUndefined();
    expect(styles.statusCode).toBe(200);
    expect(styles.headers["content-type"]).toContain("text/css");
    expect(animation.statusCode).toBe(200);
    expect(animation.headers["content-type"]).toContain("application/octet-stream");
    expect(animation.rawPayload.length).toBeGreaterThan(0);
    await app.close();
  });

  it("keeps HTTPS upgrade and HSTS headers enabled in production", async () => {
    const app = buildApp({ isDevelopment: false, logger: false });
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.headers["content-security-policy"]).toContain(
      "upgrade-insecure-requests",
    );
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    await app.close();
  });
});
