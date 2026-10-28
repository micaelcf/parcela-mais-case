import type { Job, WorkOptions } from "pg-boss";

import { boss, startBoss, stopBoss } from "#/server/infra/queue/boss";
import { logger } from "#/server/lib/log/logger";

/** One queue a worker consumes: its pg-boss work options and a handler for each fetched batch. */
export type JobRegistration = {
  queue: string;
  options: WorkOptions;
  handle(jobs: Job<object>[]): Promise<void>;
};

export type WorkerRuntime = { start(): Promise<void>; stop(): Promise<void> };

/**
 * The generic worker: starts the shared pg-boss instance, `work()`s every registered queue, and
 * stops gracefully (in-flight handlers finish, then pg-boss stops).
 */
export function createWorkerRuntime(registrations: readonly JobRegistration[]): WorkerRuntime {
  let started = false;

  return {
    async start() {
      if (started) return;
      started = true;
      await startBoss();
      for (const registration of registrations) {
        await boss.work<object>(registration.queue, registration.options, async (jobs) => {
          try {
            await registration.handle(jobs);
          } catch (error) {
            logger.error("worker.job_failed", {
              queue: registration.queue,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        });
      }
      logger.info("worker.started", { queues: registrations.map((r) => r.queue).join(",") });
    },

    async stop() {
      if (!started) return;
      started = false;
      for (const registration of registrations) {
        await boss.offWork(registration.queue, { wait: true });
      }
      await stopBoss();
      logger.info("worker.stopped");
    },
  };
}
