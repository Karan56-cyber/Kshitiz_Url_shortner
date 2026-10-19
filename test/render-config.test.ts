import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Render service configuration", () => {
  it("uses paid always-on compute for the API service", async () => {
    const config = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

    expect(config).toMatch(/^\s+plan:\s+0\.5c-512mb\s*$/m);
    expect(config).not.toMatch(/^\s+plan:\s+free\s*$/m);
  });
});
