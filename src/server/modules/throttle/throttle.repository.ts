import { and, asc, eq, gt, lt, sql } from "drizzle-orm";

import { db, type DbOrTx } from "#/server/infra/db/client";
import { requestThrottle } from "#/server/modules/throttle/db/request-throttle.table";

export type RequestThrottleRow = typeof requestThrottle.$inferSelect;
export type ThrottleRoute = RequestThrottleRow["route"];

export const throttleRepository = {
  async insert(input: { ipHmac: Buffer; route: ThrottleRoute }): Promise<string> {
    const [row] = await db
      .insert(requestThrottle)
      .values(input)
      .returning({ id: requestThrottle.id });
    if (!row) throw new Error("request_throttle insert returned no row");
    return row.id;
  },

  /** Rows for one IP and route created in the last `windowMinutes` (database clock). */
  async countRecent(ipHmac: Buffer, route: ThrottleRoute, windowMinutes: number): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(requestThrottle)
      .where(
        and(
          eq(requestThrottle.ipHmac, ipHmac),
          eq(requestThrottle.route, route),
          gt(requestThrottle.createdAt, sql`now() - make_interval(mins => ${windowMinutes})`),
        ),
      );
    return row?.count ?? 0;
  },

  async recordOutcome(id: string, statusCode: number, errorCode: string | null): Promise<void> {
    await db
      .update(requestThrottle)
      .set({ statusCode, errorCode })
      .where(eq(requestThrottle.id, id));
  },

  /** Deletes every row created before `cutoff`; returns how many. */
  async deleteCreatedBefore(cutoff: Date): Promise<number> {
    const rows = await db
      .delete(requestThrottle)
      .where(lt(requestThrottle.createdAt, cutoff))
      .returning({ id: requestThrottle.id });
    return rows.length;
  },

  /** Every row of one IP hash, oldest first (backoffice, test assertions). */
  listByIpHmac(ipHmac: Buffer, executor: DbOrTx = db): Promise<RequestThrottleRow[]> {
    return executor
      .select()
      .from(requestThrottle)
      .where(eq(requestThrottle.ipHmac, ipHmac))
      .orderBy(asc(requestThrottle.createdAt), asc(requestThrottle.id));
  },
};
