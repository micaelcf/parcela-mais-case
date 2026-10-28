import { eq, sql } from "drizzle-orm";

import type { BrState } from "#/lib/address/address";
import type { Tx } from "#/server/infra/db/client";
import { patient } from "#/server/modules/patient/db/patient.table";

/** The normalised address as stored (`complement` null when absent). */
export type PatientAddressColumns = {
  addressCep: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string | null;
  addressNeighborhood: string;
  addressCity: string;
  addressState: BrState;
};

export type PatientUpsert = PatientAddressColumns & {
  cpfHmac: Buffer;
  cpfCiphertext: Buffer;
  cpfKeyVersion: number;
  fullName: string;
  birthdate: string;
  phone: string;
};

export const patientRepository = {
  /**
   * Insert, or refresh name/birthdate/phone/address of the patient with this blind index (never
   * the ciphertext): the latest submission wins.
   */
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
          addressCep: row.addressCep,
          addressStreet: row.addressStreet,
          addressNumber: row.addressNumber,
          addressComplement: row.addressComplement,
          addressNeighborhood: row.addressNeighborhood,
          addressCity: row.addressCity,
          addressState: row.addressState,
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
