import { THROTTLE_PURGE_QUEUE } from "#/server/infra/queue/queues";
import type { JobRegistration } from "#/server/infra/worker/run-worker";
import { logger } from "#/server/lib/log/logger";

import { throttleService } from "./throttle.service";

/** `throttle.purge` (every 15 min, cron scheduled by `migrate`): drops expired throttle rows. */
export const throttlePurgeJob: JobRegistration = {
  queue: THROTTLE_PURGE_QUEUE,
  options: { batchSize: 1 },
  async handle() {
    const deleted = await throttleService.purgeExpired();
    logger.info("throttle.purged", { deleted });
  },
};
