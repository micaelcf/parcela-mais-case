#!/usr/bin/env bun
/** `bun scripts/ops/migrate.ts`: apply drizzle migrations, the pg-boss schema and the queues. */
import { migrateDatabase } from "#/server/infra/db/migrate";

import { scriptLog } from "./lib/script-log";

const log = scriptLog("migrate");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  log("✗ DATABASE_URL is not set (put it in .env.local or the environment)");
  process.exit(1);
}

try {
  await migrateDatabase(databaseUrl);
  log("✓ database migrated (drizzle + pg-boss + queues)");
} catch (error) {
  log(`✗ migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
