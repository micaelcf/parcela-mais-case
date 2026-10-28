import { defineRelationsPart } from "drizzle-orm";

import { consultationRelations } from "#/server/modules/consultation/db/consultation.relations";
import { lenderAttemptRelations } from "#/server/modules/lender/db/lender-attempt.relations";
import { patientRelations } from "#/server/modules/patient/db/patient.relations";
import { offerRelations } from "#/server/modules/pricing/db/offer.relations";

import * as schema from "./schema";

/** Every table first, then each module's relations part (contract `schema.md`). */
export const relations = {
  ...defineRelationsPart(schema),
  ...consultationRelations,
  ...patientRelations,
  ...lenderAttemptRelations,
  ...offerRelations,
};
