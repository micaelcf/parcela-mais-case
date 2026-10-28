import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "#/server/infra/env/server-env";

import { relations } from "./relations";

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle({ client: pool, relations });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function closeDb(): Promise<void> {
  await pool.end();
}
