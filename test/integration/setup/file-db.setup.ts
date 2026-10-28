import { randomBytes } from "node:crypto";

import { Client } from "pg";

import { ADMIN_URL_ENV, databaseUrl, TEMPLATE_ENV } from "./database-url";

/**
 * Before each test file imports app code: clone the run's template into a database of its own
 * and point `DATABASE_URL` at it, so breaker windows, kill switches and rate limits never leak
 * between files. The global teardown drops it.
 */
const template = process.env[TEMPLATE_ENV];
const adminUrl = process.env[ADMIN_URL_ENV];
if (!template || !adminUrl) throw new Error("integration global setup did not run");

const database = `${template.replace(/_tpl$/, "")}_${randomBytes(4).toString("hex")}`;
const client = new Client({ connectionString: adminUrl, application_name: "parcela-test-setup" });
await client.connect();
try {
  await client.query(`CREATE DATABASE "${database}" TEMPLATE "${template}"`);
} finally {
  await client.end();
}

process.env.DATABASE_URL = databaseUrl(adminUrl, database);
