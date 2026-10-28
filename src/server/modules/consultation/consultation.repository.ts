import { and, eq, isNull, sql } from "drizzle-orm";

import type { SimulationScenario } from "#/lib/enums";
import { db, type DbOrTx, type Tx } from "#/server/infra/db/client";
import { consultation } from "#/server/modules/consultation/db/consultation.table";

import type { ConsultationViewRows } from "./consultation.dto";

export type ConsultationRow = typeof consultation.$inferSelect;

export type NewConsultation = {
  patientId: string;
  idempotencyKey: string;
  requestHash: string;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
  birthdate: string;
  ageYears: number;
  simulationScenario: SimulationScenario;
  deadlineMs: number;
};

export const consultationRepository = {
  async findByIdempotencyKey(
    idempotencyKey: string,
    executor: DbOrTx = db,
  ): Promise<{ id: string; requestHash: string } | undefined> {
    const [row] = await executor
      .select({ id: consultation.id, requestHash: consultation.requestHash })
      .from(consultation)
      .where(eq(consultation.idempotencyKey, idempotencyKey));
    return row;
  },

  /**
   * Inserts with `deadline_at = now() + deadlineMs` on the database clock; undefined when a
   * concurrent request took the same idempotency key first.
   */
  async insert(
    tx: Tx,
    input: NewConsultation,
  ): Promise<{ id: string; deadlineAt: Date } | undefined> {
    const { deadlineMs, ...values } = input;
    const [row] = await tx
      .insert(consultation)
      .values({
        ...values,
        deadlineAt: sql`now() + make_interval(secs => ${deadlineMs / 1000})`,
      })
      .onConflictDoNothing({ target: consultation.idempotencyKey })
      .returning({ id: consultation.id, deadlineAt: consultation.deadlineAt });
    return row;
  },

  /** The stored row (backoffice detail, test assertions). */
  async findById(id: string, executor: DbOrTx = db): Promise<ConsultationRow | undefined> {
    const [row] = await executor.select().from(consultation).where(eq(consultation.id, id));
    return row;
  },

  /**
   * `SELECT … FOR NO KEY UPDATE`: the consultation row lock that serialises settle and choose.
   * Not `FOR UPDATE`: every offer insert takes `FOR KEY SHARE` on its consultation (FK check), which
   * `FOR UPDATE` conflicts with, so two attempts settling with offers would deadlock.
   */
  async lockById(tx: Tx, id: string): Promise<ConsultationRow | undefined> {
    const [row] = await tx
      .select()
      .from(consultation)
      .where(eq(consultation.id, id))
      .for("no key update");
    return row;
  },

  /** QUOTING → SETTLED, once. */
  async markSettled(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx
      .update(consultation)
      .set({ quoteStatus: "SETTLED", settledAt: sql`clock_timestamp()` })
      .where(and(eq(consultation.id, id), eq(consultation.quoteStatus, "QUOTING")))
      .returning({ id: consultation.id });
    return rows.length > 0;
  },

  /** Sets the choice once; false when one already exists. */
  async setChoice(tx: Tx, id: string, offerId: string): Promise<boolean> {
    const rows = await tx
      .update(consultation)
      .set({ chosenOfferId: offerId, chosenAt: sql`clock_timestamp()` })
      .where(and(eq(consultation.id, id), isNull(consultation.chosenOfferId)))
      .returning({ id: consultation.id });
    return rows.length > 0;
  },

  /** The view rows plus whether the deadline has passed (database clock). */
  async findViewRows(
    executor: DbOrTx,
    id: string,
  ): Promise<(ConsultationViewRows & { pastDeadline: boolean }) | undefined> {
    const row = await executor.query.consultation.findFirst({
      where: { id },
      extras: { pastDeadline: (table) => sql<boolean>`${table.deadlineAt} <= clock_timestamp()` },
      with: {
        patient: { columns: { fullName: true } },
        attempts: true,
        offers: true,
      },
    });
    if (!row) return undefined;
    const { patient, attempts, offers, pastDeadline, ...consultationRow } = row;
    return {
      consultation: consultationRow,
      patientFullName: patient.fullName,
      attempts,
      offers,
      pastDeadline,
    };
  },
};
