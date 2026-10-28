import type { LatencyRange } from "./scenario";

/** Uniform draw in `range`, multiplied by `timeScale`. */
export function drawLatencyMs(
  range: LatencyRange,
  timeScale: number,
  random: () => number,
): number {
  return (range.minMs + random() * (range.maxMs - range.minMs)) * timeScale;
}

/**
 * Sleeps at least `ms` (re-arming the timer if it fires early) unless `signal` aborts first.
 * Resolves `true` when the full delay elapsed, `false` when aborted.
 */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const end = performance.now() + ms;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const tick = () => {
      const left = end - performance.now();
      if (left <= 0) {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
        return;
      }
      timer = setTimeout(tick, Math.ceil(left));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    tick();
  });
}
