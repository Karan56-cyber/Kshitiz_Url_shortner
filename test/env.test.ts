import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";

const baseEnvironment = {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: "3000",
  JWT_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  PUBLIC_BASE_URL: "http://localhost:3000",
};

describe("environment loading", () => {
  it("allows database-free demo mode only outside production", () => {
    const environment = loadEnvironment({
      ...baseEnvironment,
      DEMO_MODE: "true",
    });
    expect(environment.DEMO_MODE).toBe(true);
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.REDIS_URL).toBeUndefined();

    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        NODE_ENV: "production",
        DEMO_MODE: "true",
      }),
    ).toThrow();
  });

  it("requires PostgreSQL and Redis when demo mode is disabled", () => {
    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        DEMO_MODE: "false",
      }),
    ).toThrow();

    const environment = loadEnvironment({
      ...baseEnvironment,
      DEMO_MODE: "false",
      DATABASE_URL: "postgresql://user:password@localhost:5432/linkpulse",
      REDIS_URL: "redis://localhost:6379",
    });
    expect(environment.DEMO_MODE).toBe(false);
  });

  it("keeps the embedded worker opt-in and accepts Render's true value", () => {
    const demoEnvironment = loadEnvironment({
      ...baseEnvironment,
      DEMO_MODE: "true",
    });
    expect(demoEnvironment.EMBEDDED_WORKER).toBe(false);

    const productionEnvironment = loadEnvironment({
      ...baseEnvironment,
      NODE_ENV: "production",
      DEMO_MODE: "false",
      DATABASE_URL: "postgresql://user:password@localhost:5432/linkpulse",
      REDIS_URL: "redis://localhost:6379",
      EMBEDDED_WORKER: "true",
    });
    expect(productionEnvironment.EMBEDDED_WORKER).toBe(true);
  });
});
