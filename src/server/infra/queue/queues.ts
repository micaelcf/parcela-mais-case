import type { Queue } from "pg-boss";

import { LENDER_CODES, type LenderCode } from "#/lib/enums";

/** `lender.alfa` … `lender.delta`: one queue per lender, so a slow lender never blocks another. */
export const lenderQueue = (lender: LenderCode) => `lender.${lender.toLowerCase()}` as const;

export const FINALIZE_QUEUE = "consultation.finalize";
export const THROTTLE_PURGE_QUEUE = "throttle.purge";
export const THROTTLE_PURGE_CRON = "*/15 * * * *";

/** Every queue and its options; the single source for `migrate` and the worker. */
export const QUEUES: ReadonlyArray<{ name: string; options: Omit<Queue, "name"> }> = [
  // RFC D10: no lender retries. A failed call is an answer (UNAVAILABLE), not a job failure.
  ...LENDER_CODES.map((lender) => ({
    name: lenderQueue(lender),
    options: { retryLimit: 0, notify: true, expireInSeconds: 60 },
  })),
  // Finalizing is idempotent, so a crashed attempt is safe to retry.
  { name: FINALIZE_QUEUE, options: { retryLimit: 3, retryDelay: 1, notify: true } },
  { name: THROTTLE_PURGE_QUEUE, options: { retryLimit: 1 } },
];
