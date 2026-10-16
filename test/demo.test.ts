import { afterEach, describe, expect, it } from "vitest";
import { DemoStore } from "../src/demo/store.js";
import { buildApp } from "../src/app.js";

describe("local demo mode", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createDemoApp() {
    const store = new DemoStore();
    const app = buildApp({
      demoMode: true,
      database: {
        checkConnection: async () => {},
        disconnect: async () => {},
      },
      auth: {
        repository: store,
        jwtSecret: "test-secret-that-is-at-least-thirty-two-characters",
      },
      analytics: { repository: store, authRepository: store },
      links: {
        repository: store,
        authRepository: store,
        publicBaseUrl: "http://localhost:3000",
        onClickAccepted: (event) => store.persistClickEvent(event),
      },
      logger: false,
    });
    apps.push(app);
    return app;
  }

  it("supports guest short-link creation, redirect tracking, and persisted-style analytics", async () => {
    const app = createDemoApp();
    const health = await app.inject({ method: "GET", url: "/health/live" });
    const guestResponse = await app.inject({
      method: "POST",
      url: "/auth/guest",
    });
    const guest = guestResponse.json();
    const headers = { authorization: `Bearer ${guest.accessToken}` };
    const workspaceId = guest.workspace.id;

    expect(health.json()).toEqual({ status: "ok", demoMode: true });
    expect(guestResponse.statusCode).toBe(201);

    const created = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/links`,
      headers,
      payload: {
        alias: "demo-link",
        destinationUrl: "https://example.com/demo",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().shortUrl).toBe("http://localhost:3000/demo-link");

    const redirect = await app.inject({
      method: "GET",
      url: "/demo-link",
      headers: { "user-agent": "Mozilla/5.0 Chrome/130.0" },
    });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("https://example.com/demo");

    const range = new URLSearchParams({
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const overview = await app.inject({
      method: "GET",
      url: `/workspaces/${workspaceId}/analytics/overview?${range}`,
      headers,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      totalClicks: 1,
      totalLinks: 1,
      topLinks: [{ alias: "demo-link", clicks: 1 }],
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "new@example.com", password: "incorrect password" },
    });
    expect(login.statusCode).toBe(401);
  });

  it("supports registered sign-in in demo mode", async () => {
    const app = createDemoApp();
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "demo@example.com", password: "a demo password 123" },
    });
    expect(registration.statusCode).toBe(201);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "DEMO@example.com", password: "a demo password 123" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toEqual(expect.any(String));
  });

  it("prevents one guest from reading another guest workspace analytics", async () => {
    const app = createDemoApp();
    const firstGuest = await app.inject({ method: "POST", url: "/auth/guest" });
    const secondGuest = await app.inject({ method: "POST", url: "/auth/guest" });
    const firstWorkspaceId = firstGuest.json().workspace.id;

    const response = await app.inject({
      method: "GET",
      url: `/workspaces/${firstWorkspaceId}/analytics/overview`,
      headers: {
        authorization: `Bearer ${secondGuest.json().accessToken}`,
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
