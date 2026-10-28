import { describe, expect, it } from "vite-plus/test";

import type { AttemptReason, AttemptStatus } from "#/lib/enums";

import { type BreakerSample, breakerState } from "./circuit-breaker";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const LATENCY_MS = 400;

function sample(
  status: AttemptStatus,
  reason: AttemptReason | null,
  calledAgoMs: number,
): BreakerSample {
  const calledAt = new Date(NOW.getTime() - calledAgoMs);
  return { status, reason, calledAt, settledAt: new Date(calledAt.getTime() + LATENCY_MS) };
}

const FAILURE_REASONS = ["LENDER_ERROR", "TIMEOUT", "INTEGRATION_ERROR"] as const;

/** `count` failures called 1 s apart, the newest `newestAgoMs` ago (newest first). */
const failures = (count: number, newestAgoMs: number) =>
  Array.from({ length: count }, (_, i) =>
    sample("UNAVAILABLE", FAILURE_REASONS[i % FAILURE_REASONS.length], newestAgoMs + i * 1_000),
  );

const approvals = (count: number, newestAgoMs: number) =>
  Array.from({ length: count }, (_, i) => sample("APPROVED", null, newestAgoMs + i * 1_000));

describe("circuit breaker", () => {
  it("opens at 16 failures in the last 20", () => {
    expect(breakerState([...failures(16, 10_000), ...approvals(4, 40_000)], NOW)).toBe("OPEN");
    expect(breakerState([...failures(15, 10_000), ...approvals(5, 40_000)], NOW)).toBe("CLOSED");
    // A 16th failure older than the last 20 samples doesn't count.
    expect(
      breakerState([...failures(15, 10_000), ...approvals(5, 40_000), ...failures(1, 60_000)], NOW),
    ).toBe("CLOSED");
  });

  it("half-opens 30 s after the newest call", () => {
    expect(breakerState(failures(16, 30_000), NOW)).toBe("HALF_OPEN");
    expect(breakerState(failures(16, 29_999), NOW)).toBe("OPEN");
  });

  it("counts only recent lender failures", () => {
    // 15 recent failures + 1 settled 300 001 ms before now: outside the 5 min window.
    const stale = sample("UNAVAILABLE", "LENDER_ERROR", 300_001 + LATENCY_MS);
    expect(breakerState([...failures(15, 10_000), stale], NOW)).toBe("CLOSED");

    const refused = Array.from({ length: 10 }, (_, i) =>
      sample(
        "REFUSED",
        i % 2 === 0 ? "AMOUNT_ABOVE_LIMIT" : "PROFILE_NOT_ELIGIBLE",
        10_000 + i * 1_000,
      ),
    );
    expect(breakerState([...refused, ...approvals(10, 20_000)], NOW)).toBe("CLOSED");
    expect(breakerState([...failures(15, 10_000), ...refused.slice(0, 5)], NOW)).toBe("CLOSED");
  });
});
