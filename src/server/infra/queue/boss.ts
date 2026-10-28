import { PgBoss } from "pg-boss";

import { env } from "#/server/infra/env/server-env";
import { logger } from "#/server/lib/log/logger";

/**
 * The app's and the worker's pg-boss instance: its own small pool (max 3) so LISTEN/NOTIFY and
 * reconnects stay inside pg-boss. The schema is installed by `migrate`, never at start.
 */
export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  max: 3,
  useListenNotify: true,
  migrate: false,
  createSchema: false,
  application_name: "parcela-boss",
});

boss.on("error", (error: Error) => {
  logger.error("queue.error", { message: error.message });
});

let started: Promise<PgBoss> | undefined;

/** Starts the instance once per process; later calls share the same start. */
export function startBoss(): Promise<PgBoss> {
  started ??= boss.start();
  return started;
}

export async function stopBoss(): Promise<void> {
  if (!started) return;
  await boss.stop({ graceful: true, timeout: 15_000 });
  started = undefined;
}
