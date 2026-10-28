import Type from "typebox";
import { Compile } from "typebox/compile";

import { FINALIZE_QUEUE } from "#/server/infra/queue/queues";
import type { JobRegistration } from "#/server/infra/worker/run-worker";
import { logger } from "#/server/lib/log/logger";

import { consultationService } from "./consultation.service";

const FinalizeJobData = Compile(Type.Object({ consultationId: Type.String() }));

/**
 * `consultation.finalize`: sent with `startAfter = deadline_at`. Polls every 0.5 s (pg-boss's
 * minimum) so a consultation is terminal within deadline + 1 s even when no lender job settles it.
 */
export const consultationFinalizeJob: JobRegistration = {
  queue: FINALIZE_QUEUE,
  options: {
    batchSize: 20,
    pollingIntervalSeconds: 0.5,
    notifyPollingIntervalSeconds: 0.5,
  },
  async handle(jobs) {
    await Promise.all(
      jobs.map((job) => {
        if (FinalizeJobData.Check(job.data))
          return consultationService.finalize(job.data.consultationId);
        logger.error("consultation.finalize_job_invalid", { jobId: job.id });
        return Promise.resolve();
      }),
    );
  },
};
