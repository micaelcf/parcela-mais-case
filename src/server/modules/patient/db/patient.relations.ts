import { defineRelationsPart } from "drizzle-orm";

import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { patient } from "#/server/modules/patient/db/patient.table";

export const patientRelations = defineRelationsPart({ patient, consultation }, (r) => ({
  patient: {
    consultations: r.many.consultation({ from: r.patient.id, to: r.consultation.patientId }),
  },
}));
