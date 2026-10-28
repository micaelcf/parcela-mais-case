import { defineRelationsPart } from "drizzle-orm";

import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";
import { offer } from "#/server/modules/pricing/db/offer.table";

export const lenderAttemptRelations = defineRelationsPart(
  { lenderAttempt, consultation, offer },
  (r) => ({
    lenderAttempt: {
      consultation: r.one.consultation({
        from: r.lenderAttempt.consultationId,
        to: r.consultation.id,
        optional: false,
      }),
      offers: r.many.offer({ from: r.lenderAttempt.id, to: r.offer.attemptId }),
    },
  }),
);
