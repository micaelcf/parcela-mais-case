import { closeDb } from "#/server/infra/db/client";
import { logger } from "#/server/lib/log/logger";

import { createWorker } from "./worker";

/** Worker process entry: start every job, stop gracefully on SIGTERM/SIGINT. */
const worker = createWorker();

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info("worker.shutdown", { signal });
  try {
    await worker.stop();
    await closeDb();
    process.exit(0);
  } catch (error) {
    logger.error("worker.shutdown_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await worker.start();
