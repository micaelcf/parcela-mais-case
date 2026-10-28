import { boolean, pgTable, timestamp } from "drizzle-orm/pg-core";

import { lenderCodeEnum } from "#/server/infra/db/enums";

/** Kill switch per lender; the migration seeds all four enabled. */
export const lenderSetting = pgTable("lender_setting", {
  lender: lenderCodeEnum("lender").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
