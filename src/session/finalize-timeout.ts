// Hard timeout around best-effort post-query cleanup that can pin the
// event loop. Specifically: `bubble.finalize` issues a Telegram API edit
// that has been observed to hang for hours (no timeout in grammy / no
// retry abort), which blocks the surrounding `finally{}` from reaching
// `queueManager.unregister` and leaves the session "active" forever.
// New turns then pile up in `pending` and never drain, manifesting as
// "bot is silent, all messages buffered". Bounding finalize ensures the
// caller's cleanup always completes, even when finalize itself hangs.
//
// Returns the wrapped promise's value if it settles in time, or
// `undefined` if the timeout fires first (and invokes `onTimeout` so the
// caller can log). Errors from the wrapped promise propagate normally.
export async function runWithFinalizeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T | undefined> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutHandle = setTimeout(() => {
      onTimeout();
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
