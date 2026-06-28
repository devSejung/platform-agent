/**
 * Wait for compaction retry completion with an aggregate timeout to avoid
 * holding a session lane indefinitely when retry resolution is lost.
 */
export function hasActiveCompactionRetryWork(params: {
  isCompactionInFlight: boolean;
  isSessionStreaming: boolean;
}): boolean {
  return params.isCompactionInFlight || params.isSessionStreaming;
}

export async function waitForCompactionRetryWithAggregateTimeout(params: {
  waitForCompactionRetry: () => Promise<void>;
  abortable: <T>(promise: Promise<T>) => Promise<T>;
  aggregateTimeoutMs: number;
  onTimeout?: () => void;
  isCompactionRetryStillActive?: () => boolean;
}): Promise<{ timedOut: boolean }> {
  const timeoutMsRaw = params.aggregateTimeoutMs;
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(1, Math.floor(timeoutMsRaw)) : 1;

  let timedOut = false;
  // Reflect the retry promise so late rejections after a timeout stay handled
  // without masking failures that settle before the timeout path wins.
  const waitPromise = params.waitForCompactionRetry().then(
    () => ({ kind: "done" as const }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );

  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await params.abortable(
        Promise.race([
          waitPromise,
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), timeoutMs);
          }),
        ]),
      );

      if (result !== "timeout") {
        if (result.kind === "done") {
          break;
        }
        throw result.error;
      }

      // A post-compaction retry is a normal model run, so compaction itself can
      // be idle while the provider request is still active. Only trigger
      // deadlock recovery after both phases are idle.
      if (params.isCompactionRetryStillActive?.()) {
        continue;
      }

      timedOut = true;
      params.onTimeout?.();
      break;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return { timedOut };
}
