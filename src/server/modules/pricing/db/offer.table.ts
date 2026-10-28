import { bigint, numeric, pgTable, smallint, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { lenderCodeEnum } from "#/server/infra/db/enums";
import { uuidv7 } from "#/server/infra/db/uuid";
import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";

/** An immutable priced offer: one per approving attempt and term. Never updated or deleted. */
export const offer = pgTable(
  "offer",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => lenderAttempt.id),
    consultationId: uuid("consultation_id")
      .notNull()
      .references(() => consultation.id),
    lender: lenderCodeEnum("lender").notNull(),
    approvedCents: bigint("approved_cents", { mode: "number" }).notNull(),
    requestedCents: bigint("requested_cents", { mode: "number" }).notNull(),
    monthlyRate: numeric("monthly_rate", { precision: 7, scale: 6 }).notNull(),
    termMonths: smallint("term_months").notNull(),
    installmentCents: bigint("installment_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("offer_attempt_term_key").on(table.attemptId, table.termMonths)],
);
