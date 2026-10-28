import { defineRelationsPart } from "drizzle-orm";

import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";
import { offer } from "#/server/modules/pricing/db/offer.table";

export const offerRelations = defineRelationsPart({ offer, lenderAttempt, consultation }, (r) => ({
  offer: {
    attempt: r.one.lenderAttempt({
      from: r.offer.attemptId,
      to: r.lenderAttempt.id,
      optional: false,
    }),
    consultation: r.one.consultation({
      from: r.offer.consultationId,
      to: r.consultation.id,
      optional: false,
    }),
  },
}));
