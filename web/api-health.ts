const retryDelays = [0, 2_000, 5_000, 10_000];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryable(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status >= 500;
  }
  return true;
}

export async function retryApiHealthCheck<T>(
  check: () => Promise<T>,
  pause: (milliseconds: number) => Promise<void> = wait,
): Promise<T> {
  let lastError: unknown;
  for (const [attempt, delay] of retryDelays.entries()) {
    if (delay > 0) await pause(delay);
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retryDelays.length - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}
