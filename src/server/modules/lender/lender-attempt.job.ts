import Type from "typebox";
import { Compile } from "typebox/compile";

import { LENDER_CODES } from "#/lib/enums";
import { lenderQueue } from "#/server/infra/queue/queues";
import type { JobRegistration } from "#/server/infra/worker/run-worker";
import type { LenderRegistry } from "#/server/integrations/lenders/registry";
import { logger } from "#/server/lib/log/logger";

import { lenderAttemptService } from "./lender-attempt.service";

const LenderJobData = Compile(Type.Object({ attemptId: Type.String() }));

/** Jobs in flight per lender queue and process: calls are I/O-bound and bounded by the deadline. */
const LENDER_CONCURRENCY = 25;

/** One registration per lender queue (`lender.alfa` …): each job runs one attempt. */
export function lenderAttemptJobs(registry: LenderRegistry): JobRegistration[] {
  return LENDER_CODES.map((lender) => ({
    queue: lenderQueue(lender),
    options: { localConcurrency: LENDER_CONCURRENCY, batchSize: 1 },
    async handle(jobs) {
      for (const job of jobs) {
        if (!LenderJobData.Check(job.data)) {
          logger.error("lender.job_invalid", { queue: job.name, jobId: job.id });
          continue;
        }
        await lenderAttemptService.run(job.data.attemptId, registry);
      }
    },
  }));
}
