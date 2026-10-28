import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { lenderCodeEnum } from "#/server/infra/db/enums";
import { uuidv7 } from "#/server/infra/db/uuid";

/** Append-only audit of kill-switch changes (RF-609). */
export const lenderSwitchLog = pgTable(
  "lender_switch_log",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    lender: lenderCodeEnum("lender").notNull(),
    enabled: boolean("enabled").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lender_switch_log_created_id_idx").on(table.createdAt, table.id)],
);
