#!/usr/bin/env bun
/** `bun scripts/ops/migrate.ts`: apply drizzle migrations, the pg-boss schema and the queues. */
import { migrateDatabase } from "#/server/infra/db/migrate";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("✗ DATABASE_URL is not set (put it in .env.local or the environment)");
  process.exit(1);
}

try {
  await migrateDatabase(databaseUrl);
  console.log("✓ database migrated (drizzle + pg-boss + queues)");
} catch (error) {
  console.error("✗ migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
