import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel proxy routes", () => {
  it("forwards aliases across the API's complete supported length range", async () => {
    const config = JSON.parse(
      await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as {
      rewrites: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites).toContainEqual({
      source: "/:alias([a-zA-Z0-9_-]{3,64})",
      destination: "https://linkpulse-api-0w93.onrender.com/:alias",
    });
  });
});
