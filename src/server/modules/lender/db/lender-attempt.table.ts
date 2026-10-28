import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  attemptReasonEnum,
  attemptStatusEnum,
  lenderCodeEnum,
  simulationScenarioEnum,
} from "#/server/infra/db/enums";
import { uuidv7 } from "#/server/infra/db/uuid";
import { consultation } from "#/server/modules/consultation/db/consultation.table";

/** One lender's answer to one consultation; settles exactly once (guarded on PENDING). */
export const lenderAttempt = pgTable(
  "lender_attempt",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    consultationId: uuid("consultation_id")
      .notNull()
      .references(() => consultation.id),
    lender: lenderCodeEnum("lender").notNull(),
    simulationScenario: simulationScenarioEnum("simulation_scenario").notNull(),
    status: attemptStatusEnum("status").notNull().default("PENDING"),
    reason: attemptReasonEnum("reason"),
    approvedCents: bigint("approved_cents", { mode: "number" }),
    monthlyRate: numeric("monthly_rate", { precision: 7, scale: 6 }),
    maxApprovableCents: bigint("max_approvable_cents", { mode: "number" }),
    breakerProbe: boolean("breaker_probe").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    calledAt: timestamp("called_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
  },
  (table) => [
    unique("lender_attempt_consultation_lender_key").on(table.consultationId, table.lender),
    index("lender_attempt_breaker_idx").on(
      table.lender,
      table.simulationScenario,
      sql`${table.settledAt} desc`,
    ),
  ],
);
