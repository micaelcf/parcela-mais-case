import { pgEnum } from "drizzle-orm/pg-core";

import {
  ATTEMPT_REASONS,
  ATTEMPT_STATUSES,
  LENDER_CODES,
  QUOTE_STATUSES,
  SIMULATION_SCENARIOS,
} from "#/lib/enums";

export const lenderCodeEnum = pgEnum("lender_code", LENDER_CODES);
export const simulationScenarioEnum = pgEnum("simulation_scenario", SIMULATION_SCENARIOS);
export const quoteStatusEnum = pgEnum("quote_status", QUOTE_STATUSES);
export const attemptStatusEnum = pgEnum("attempt_status", ATTEMPT_STATUSES);
export const attemptReasonEnum = pgEnum("attempt_reason", ATTEMPT_REASONS);
