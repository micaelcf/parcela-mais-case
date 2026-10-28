import { Client } from "pg";
import { describe, expect, it } from "vite-plus/test";

import { migrateDatabase } from "#/server/infra/db/migrate";

async function readSettings(): Promise<Array<{ lender: string; enabled: boolean }>> {
  // Assertion-only raw read: the lender-setting service doesn't exist below this layer.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ lender: string; enabled: boolean }>(
      "SELECT lender, enabled FROM lender_setting ORDER BY lender",
    );
    return rows;
  } finally {
    await client.end();
  }
}

describe("migrateDatabase", () => {
  it("is idempotent and seeds the four lenders enabled", async () => {
    const expected = [
      { lender: "ALFA", enabled: true },
      { lender: "BETA", enabled: true },
      { lender: "GAMA", enabled: true },
      { lender: "DELTA", enabled: true },
    ];
    expect(await readSettings()).toEqual(expected);

    await migrateDatabase(String(process.env.DATABASE_URL));

    expect(await readSettings()).toEqual(expected);
  });
});
