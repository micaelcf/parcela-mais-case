import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { migrateDatabase } from "#/server/infra/db/migrate";

import { ADMIN_URL_ENV, databaseUrl, TEMPLATE_ENV } from "./database-url";

/**
 * Once per run: a migrated template database (`test_<run>_tpl`) that every test file clones,
 * and a teardown that drops every database of this run.
 */
export default async function setup(project: { config: { env?: Record<string, unknown> } }) {
  // Global setup runs in the main process, which doesn't see the project's `test.env`.
  const configured = project.config.env?.DATABASE_URL;
  const adminUrl = typeof configured === "string" ? configured : process.env.DATABASE_URL;
  if (!adminUrl)
    throw new Error("DATABASE_URL must point at the compose Postgres for integration tests");
  const run = randomBytes(4).toString("hex");
  const template = `test_${run}_tpl`;

  await withClient(adminUrl, (client) => client.query(`CREATE DATABASE "${template}"`));
  await migrateDatabase(databaseUrl(adminUrl, template));

  process.env[TEMPLATE_ENV] = template;
  process.env[ADMIN_URL_ENV] = adminUrl;

  return async function teardown() {
    await withClient(adminUrl, async (client) => {
      const { rows } = await client.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1",
        [`test\\_${run}\\_%`],
      );
      for (const { datname } of rows) {
        await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
      }
    });
  };
}

async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url, application_name: "parcela-test-setup" });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
