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
      PUBLIC_BASE_URL: "https://short.example.com",
      EMBEDDED_WORKER: "true",
    });
    expect(productionEnvironment.EMBEDDED_WORKER).toBe(true);
  });

  it("accepts complete SMTP settings and rejects partial SMTP configuration", () => {
    const environment = loadEnvironment({
      ...baseEnvironment,
      DEMO_MODE: "true",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "sender",
      SMTP_PASS: "secret",
      SMTP_FROM: "LinkPulse <hello@example.com>",
    });
    expect(environment.SMTP_SECURE).toBe(false);
    expect(environment.SMTP_PORT).toBe(587);
    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        DEMO_MODE: "true",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow();
  });

  it("restricts public URLs to credential-free HTTP(S) origins", () => {
    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        DEMO_MODE: "true",
        PUBLIC_BASE_URL: "ftp://short.example.com",
      }),
    ).toThrow();
    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        NODE_ENV: "production",
        DATABASE_URL: "******localhost:5432/linkpulse",
        REDIS_URL: "redis://localhost:6379",
        PUBLIC_BASE_URL: "http://short.example.com",
      }),
    ).toThrow();
    expect(() =>
      loadEnvironment({
        ...baseEnvironment,
        DEMO_MODE: "true",
        PUBLIC_BASE_URL: "https://user:password@short.example.com",
      }),
    ).toThrow();
  });
});
