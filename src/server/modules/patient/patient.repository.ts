import { eq, sql } from "drizzle-orm";

import type { Tx } from "#/server/infra/db/client";
import { patient } from "#/server/modules/patient/db/patient.table";

export type PatientUpsert = {
  cpfHmac: Buffer;
  cpfCiphertext: Buffer;
  cpfKeyVersion: number;
  fullName: string;
  birthdate: string;
  phone: string;
};

export const patientRepository = {
  /** Insert, or refresh name/birthdate/phone of the patient with this blind index (never the ciphertext). */
  async upsertByCpfHmac(tx: Tx, row: PatientUpsert): Promise<string> {
    const [saved] = await tx
      .insert(patient)
      .values(row)
      .onConflictDoUpdate({
        target: patient.cpfHmac,
        set: {
          fullName: row.fullName,
          birthdate: row.birthdate,
          phone: row.phone,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: patient.id });
    if (!saved) throw new Error("patient upsert returned no row");
    return saved.id;
  },

  /** `SELECT … FOR UPDATE`: serialises concurrent work on one patient until the TX ends. */
  async lockById(tx: Tx, id: string): Promise<void> {
    await tx.select({ id: patient.id }).from(patient).where(eq(patient.id, id)).for("update");
  },
};
