import { eq, sql } from "drizzle-orm";

import type { LenderCode } from "#/lib/enums";
import type { DbOrTx, Tx } from "#/server/infra/db/client";
import { lenderSetting } from "#/server/modules/lender/db/lender-setting.table";
import { lenderSwitchLog } from "#/server/modules/lender/db/lender-switch-log.table";

export type LenderSettingRow = typeof lenderSetting.$inferSelect;

export const lenderSettingRepository = {
  list(executor: DbOrTx): Promise<LenderSettingRow[]> {
    return executor.select().from(lenderSetting);
  },

  async findEnabled(executor: DbOrTx, lender: LenderCode): Promise<boolean | undefined> {
    const [row] = await executor
      .select({ enabled: lenderSetting.enabled })
      .from(lenderSetting)
      .where(eq(lenderSetting.lender, lender));
    return row?.enabled;
  },

  async update(
    tx: Tx,
    lender: LenderCode,
    enabled: boolean,
  ): Promise<{ lender: LenderCode; enabled: boolean; updatedAt: Date }> {
    const [row] = await tx
      .insert(lenderSetting)
      .values({ lender, enabled, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: lenderSetting.lender,
        set: { enabled, updatedAt: sql`now()` },
      })
      .returning();
    if (!row?.updatedAt) throw new Error("lender_setting update returned no row");
    return { lender: row.lender, enabled: row.enabled, updatedAt: row.updatedAt };
  },

  async appendSwitchLog(
    tx: Tx,
    entry: { lender: LenderCode; enabled: boolean; actor: string },
  ): Promise<void> {
    await tx.insert(lenderSwitchLog).values(entry);
  },
};
