import { createWorkerRuntime } from "#/server/infra/worker/run-worker";
import {
  lenderRegistry as defaultLenderRegistry,
  type LenderRegistry,
} from "#/server/integrations/lenders/registry";
import { consultationFinalizeJob } from "#/server/modules/consultation/consultation-finalize.job";
import { lenderAttemptJobs } from "#/server/modules/lender/lender-attempt.job";

export type Worker = { start(): Promise<void>; stop(): Promise<void> };

/** Worker composition root: every module job on the generic runtime. */
export function createWorker(deps: { lenderRegistry?: LenderRegistry } = {}): Worker {
  return createWorkerRuntime([
    ...lenderAttemptJobs(deps.lenderRegistry ?? defaultLenderRegistry),
    consultationFinalizeJob,
  ]);
}
