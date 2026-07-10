const DEFAULT_D1_RETRY_DELAYS_MS = [100, 300] as const;
const DEFAULT_D1_READ_TIMEOUT_MS = 1_800;

class D1ReadTimeoutError extends Error {
  constructor() {
    super("d1_read_timeout");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation,
    sleep(timeoutMs).then(() => {
      throw new D1ReadTimeoutError();
    }),
  ]);
}

export function isRetryableD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Network connection lost") ||
    message.includes("storage caused object to be reset") ||
    message.includes("reset because its code was updated") ||
    message.includes("Cannot resolve D1 DB due to transient issue")
  );
}

export async function retryD1Read<T>(operation: () => Promise<T>, delaysMs: readonly number[] = DEFAULT_D1_RETRY_DELAYS_MS): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = delaysMs[attempt];
      if (!isRetryableD1Error(error) || delayMs === undefined) throw error;
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

export async function readD1OrFallback<T>(
  operation: () => Promise<T>,
  fallback: () => T,
  timeoutMs = DEFAULT_D1_READ_TIMEOUT_MS,
): Promise<T> {
  try {
    return await retryD1Read(() => withTimeout(operation(), timeoutMs));
  } catch (error) {
    if (error instanceof D1ReadTimeoutError || isRetryableD1Error(error)) return fallback();
    throw error;
  }
}
