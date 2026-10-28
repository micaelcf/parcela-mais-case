import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";

import { QUEUES, THROTTLE_PURGE_CRON, THROTTLE_PURGE_QUEUE } from "#/server/infra/queue/queues";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../../drizzle", import.meta.url));

/**
 * Brings a database fully up to date, idempotently: drizzle migrations, then the pg-boss schema,
 * then every queue and schedule. Used by `scripts/ops/migrate.ts`, the compose `migrate` service
 * and the integration-test template database. Needs only a connection string (no app env).
 */
export async function migrateDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "parcela-migrate" });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }

  const boss = new PgBoss({
    connectionString,
    max: 2,
    migrate: true,
    supervise: false,
    schedule: false,
    application_name: "parcela-migrate",
  });
  await boss.start();
  try {
    for (const queue of QUEUES) {
      if (await boss.getQueue(queue.name)) await boss.updateQueue(queue.name, queue.options);
      else await boss.createQueue(queue.name, queue.options);
    }
    await boss.schedule(THROTTLE_PURGE_QUEUE, THROTTLE_PURGE_CRON);
  } finally {
    await boss.stop({ graceful: false, timeout: 5_000 });
  }
}
