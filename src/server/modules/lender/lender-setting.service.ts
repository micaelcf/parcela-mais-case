import { LENDER_CODES, type LenderCode } from "#/lib/enums";
import { db, type Tx } from "#/server/infra/db/client";

import { lenderSettingRepository } from "./lender-setting.repository";

/** The per-lender kill switch (RF-219, RF-608/609). A lender without a row counts as enabled. */
export const lenderSettingService = {
  async list(): Promise<Array<{ lender: LenderCode; enabled: boolean; updatedAt: Date | null }>> {
    const rows = await lenderSettingRepository.list(db);
    const byLender = new Map(rows.map((row) => [row.lender, row]));
    return LENDER_CODES.map((lender) => ({
      lender,
      enabled: byLender.get(lender)?.enabled ?? true,
      updatedAt: byLender.get(lender)?.updatedAt ?? null,
    }));
  },

  async isEnabled(tx: Tx, lender: LenderCode): Promise<boolean> {
    return (await lenderSettingRepository.findEnabled(tx, lender)) ?? true;
  },

  /** One TX: flip the switch and append the audit row. */
  setEnabled(input: {
    lender: LenderCode;
    enabled: boolean;
    actor: string;
  }): Promise<{ lender: LenderCode; enabled: boolean; updatedAt: Date }> {
    return db.transaction(async (tx) => {
      const saved = await lenderSettingRepository.update(tx, input.lender, input.enabled);
      await lenderSettingRepository.appendSwitchLog(tx, input);
      return saved;
    });
  },
};
