import type { AttemptReason, AttemptStatus } from "#/lib/enums";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const BREAKER = {
  windowSize: 20,
  failureThreshold: 16,
  windowMs: 300_000,
  openMs: 30_000,
} as const;

export type BreakerSample = {
  status: AttemptStatus;
  reason: AttemptReason | null;
  calledAt: Date;
  settledAt: Date;
};

/** A lender failure: the lender itself answered badly (not a skip like CIRCUIT_OPEN/DISABLED). */
const IS_FAILURE_REASON: Record<AttemptReason, boolean> = {
  AMOUNT_ABOVE_LIMIT: false,
  PROFILE_NOT_ELIGIBLE: false,
  LENDER_ERROR: true,
  TIMEOUT: true,
  CIRCUIT_OPEN: false,
  DISABLED: false,
  INTEGRATION_ERROR: true,
};

/**
 * Derives a lender's breaker state (`boundaries.md` § Circuit breaker).
 * `samples`: the lender's NORMAL, called, settled attempts, newest first. Samples settled before
 * `now − windowMs` are dropped and at most `windowSize` are kept, so callers may over-fetch.
 * ≥ 16 failures: `OPEN` while the newest failure was called < 30 s ago, `HALF_OPEN` once the
 * newest call is ≥ 30 s old; otherwise (a recent non-failure, fewer failures) `CLOSED`.
 * Recency is measured on `calledAt`, so a successful probe after the failures closes the circuit.
 */
export function breakerState(samples: readonly BreakerSample[], now: Date): BreakerState {
  const since = now.getTime() - BREAKER.windowMs;
  const window = samples
    .filter((sample) => sample.settledAt.getTime() >= since)
    .slice(0, BREAKER.windowSize);
  const failures = window.filter(
    (sample) =>
      sample.status === "UNAVAILABLE" && sample.reason !== null && IS_FAILURE_REASON[sample.reason],
  );
  if (failures.length < BREAKER.failureThreshold) return "CLOSED";

  const newestFailureAt = Math.max(...failures.map((sample) => sample.calledAt.getTime()));
  if (now.getTime() - newestFailureAt < BREAKER.openMs) return "OPEN";

  const newestCallAt = Math.max(...window.map((sample) => sample.calledAt.getTime()));
  return now.getTime() - newestCallAt >= BREAKER.openMs ? "HALF_OPEN" : "CLOSED";
}
