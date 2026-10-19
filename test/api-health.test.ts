import { describe, expect, it, vi } from "vitest";
import { retryApiHealthCheck } from "../web/api-health.js";

describe("API health startup retries", () => {
  it("retries transient failures with backoff before succeeding", async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error("API waking up"))
      .mockRejectedValueOnce(Object.assign(new Error("Bad gateway"), { status: 502 }))
      .mockResolvedValue({ status: "ok" });
    const pause = vi.fn().mockResolvedValue(undefined);

    await expect(retryApiHealthCheck(check, pause)).resolves.toEqual({
      status: "ok",
    });
    expect(check).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[2_000], [5_000]]);
  });

  it("does not retry client errors", async () => {
    const error = Object.assign(new Error("Not found"), { status: 404 });
    const check = vi.fn().mockRejectedValue(error);
    const pause = vi.fn().mockResolvedValue(undefined);

    await expect(retryApiHealthCheck(check, pause)).rejects.toBe(error);
    expect(check).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
  });
});
