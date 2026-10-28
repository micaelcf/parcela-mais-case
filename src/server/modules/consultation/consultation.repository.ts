import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { SimulationScenario } from "#/lib/enums";
import { db, type DbOrTx, type Tx } from "#/server/infra/db/client";
import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { patient } from "#/server/modules/patient/db/patient.table";

import type { ConsultationViewRows } from "./consultation.dto";

export type ConsultationRow = typeof consultation.$inferSelect;

/** The view rows with the full consultation row (requote reads its frozen inputs). */
export type ConsultationReadRows = ConsultationViewRows & { consultation: ConsultationRow };

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
   * `SELECT … FOR UPDATE` on the consultation's patient: serialises one patient's creates (and
   * requotes) so the per-patient cap counts committed rows only.
   */
  async lockPatient(tx: Tx, patientId: string): Promise<void> {
    await tx
      .select({ id: patient.id })
      .from(patient)
      .where(eq(patient.id, patientId))
      .for("update");
  },

  /** The patient's consultations, optionally only those created in the last `withinHours`. */
  async countByPatient(
    patientId: string,
    options: { withinHours?: number; executor?: DbOrTx } = {},
  ): Promise<number> {
    const { withinHours, executor = db } = options;
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(consultation)
      .where(
        and(
          eq(consultation.patientId, patientId),
          withinHours === undefined
            ? undefined
            : gt(consultation.createdAt, sql`now() - make_interval(hours => ${withinHours})`),
        ),
      );
    return row?.count ?? 0;
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

  /** The view rows (with the full consultation row) plus whether the deadline has passed (database clock). */
  async findViewRows(
    executor: DbOrTx,
    id: string,
  ): Promise<(ConsultationReadRows & { pastDeadline: boolean }) | undefined> {
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
    const { patient: patientRow, attempts, offers, pastDeadline, ...consultationRow } = row;
    return {
      consultation: consultationRow,
      patientFullName: patientRow.fullName,
      attempts,
      offers,
      pastDeadline,
    };
  },
};
