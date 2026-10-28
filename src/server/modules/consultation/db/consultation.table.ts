import {
  type AnyPgColumn,
  bigint,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { quoteStatusEnum, simulationScenarioEnum } from "#/server/infra/db/enums";
import { uuidv7 } from "#/server/infra/db/uuid";
import { patient } from "#/server/modules/patient/db/patient.table";
import { offer } from "#/server/modules/pricing/db/offer.table";

/** One pre-approval request with its inputs frozen at submission; the id is the capability URL. */
export const consultation = pgTable(
  "consultation",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patient.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestHash: text("request_hash").notNull(),
    monthlyIncomeCents: bigint("monthly_income_cents", { mode: "number" }).notNull(),
    treatmentAmountCents: bigint("treatment_amount_cents", { mode: "number" }).notNull(),
    birthdate: date("birthdate", { mode: "string" }).notNull(),
    ageYears: smallint("age_years").notNull(),
    simulationScenario: simulationScenarioEnum("simulation_scenario").notNull().default("NORMAL"),
    quoteStatus: quoteStatusEnum("quote_status").notNull().default("QUOTING"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // Set once by `choose`; the lazy reference breaks the consultation ⇄ offer import cycle.
    chosenOfferId: uuid("chosen_offer_id").references((): AnyPgColumn => offer.id),
    chosenAt: timestamp("chosen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("consultation_patient_created_idx").on(table.patientId, table.createdAt),
    index("consultation_created_id_idx").on(table.createdAt, table.id),
    index("consultation_quote_deadline_idx").on(table.quoteStatus, table.deadlineAt),
  ],
);
