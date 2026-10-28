import { defineRelationsPart } from "drizzle-orm";

import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";
import { patient } from "#/server/modules/patient/db/patient.table";
import { offer } from "#/server/modules/pricing/db/offer.table";

export const consultationRelations = defineRelationsPart(
  { consultation, patient, lenderAttempt, offer },
  (r) => ({
    consultation: {
      patient: r.one.patient({ from: r.consultation.patientId, to: r.patient.id, optional: false }),
      attempts: r.many.lenderAttempt({
        from: r.consultation.id,
        to: r.lenderAttempt.consultationId,
      }),
      offers: r.many.offer({ from: r.consultation.id, to: r.offer.consultationId }),
      chosenOffer: r.one.offer({ from: r.consultation.chosenOfferId, to: r.offer.id }),
    },
  }),
);
