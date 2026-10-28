/**
 * Enum values shared by the database (`pgEnum`), the API DTOs and the browser.
 * Order is meaningful: lenders are always displayed ALFA, BETA, GAMA, DELTA.
 */
export const LENDER_CODES = ["ALFA", "BETA", "GAMA", "DELTA"] as const;
export type LenderCode = (typeof LENDER_CODES)[number];

export const SIMULATION_SCENARIOS = [
  "NORMAL",
  "ALL_APPROVE",
  "DELTA_FAILS",
  "DELTA_TIMES_OUT",
  "NONE_APPROVE",
] as const;
export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

export const QUOTE_STATUSES = ["QUOTING", "SETTLED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const ATTEMPT_STATUSES = ["PENDING", "APPROVED", "REFUSED", "UNAVAILABLE"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** `AMOUNT_ABOVE_LIMIT`/`PROFILE_NOT_ELIGIBLE` go with REFUSED; the rest with UNAVAILABLE. */
export const ATTEMPT_REASONS = [
  "AMOUNT_ABOVE_LIMIT",
  "PROFILE_NOT_ELIGIBLE",
  "LENDER_ERROR",
  "TIMEOUT",
  "CIRCUIT_OPEN",
  "DISABLED",
  "INTEGRATION_ERROR",
] as const;
export type AttemptReason = (typeof ATTEMPT_REASONS)[number];
