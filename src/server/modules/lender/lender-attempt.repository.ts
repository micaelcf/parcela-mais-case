import { and, desc, eq, gt, gte, isNotNull, isNull, sql } from "drizzle-orm";

import {
  LENDER_CODES,
  type AttemptReason,
  type AttemptStatus,
  type LenderCode,
  type SimulationScenario,
} from "#/lib/enums";
import { db, type DbOrTx, type Tx } from "#/server/infra/db/client";
import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";
import { patient } from "#/server/modules/patient/db/patient.table";

import type { BreakerSample } from "./circuit-breaker";

export type LenderAttemptRow = typeof lenderAttempt.$inferSelect;

/** Everything a lender call needs, read in the pick TX. */
export type AttemptCallContext = {
  ageYears: number;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
  /** ms until the consultation deadline, by the database clock (never negative). */
  remainingMs: number;
  cpfHmac: Buffer;
  cpfCiphertext: Buffer;
};

/** The terminal fields of a guarded settle. */
export type AttemptSettlement = {
  status: Exclude<AttemptStatus, "PENDING">;
  reason: AttemptReason | null;
  approvedCents?: number | null;
  monthlyRate?: string | null;
  maxApprovableCents?: number | null;
  latencyMs?: number | null;
};

const pending = (id: string) => and(eq(lenderAttempt.id, id), eq(lenderAttempt.status, "PENDING"));

export const lenderAttemptRepository = {
  /** The four PENDING attempts of a new consultation, in lender order. */
  insertPending(
    tx: Tx,
    consultationId: string,
    simulationScenario: SimulationScenario,
  ): Promise<Array<{ id: string; lender: LenderCode }>> {
    return tx
      .insert(lenderAttempt)
      .values(LENDER_CODES.map((lender) => ({ consultationId, lender, simulationScenario })))
      .returning({ id: lenderAttempt.id, lender: lenderAttempt.lender });
  },

  /** Claims a PENDING, never-picked attempt; undefined when it was settled or picked already. */
  async pick(tx: Tx, id: string): Promise<LenderAttemptRow | undefined> {
    const [row] = await tx
      .update(lenderAttempt)
      .set({ pickedAt: sql`clock_timestamp()` })
      .where(and(pending(id), isNull(lenderAttempt.pickedAt)))
      .returning();
    return row;
  },

  async callContext(tx: Tx, consultationId: string): Promise<AttemptCallContext> {
    const [row] = await tx
      .select({
        ageYears: consultation.ageYears,
        monthlyIncomeCents: consultation.monthlyIncomeCents,
        treatmentAmountCents: consultation.treatmentAmountCents,
        remainingMs: sql<number>`greatest(0, floor(extract(epoch from (${consultation.deadlineAt} - clock_timestamp())) * 1000))::int`,
        cpfHmac: patient.cpfHmac,
        cpfCiphertext: patient.cpfCiphertext,
      })
      .from(consultation)
      .innerJoin(patient, eq(patient.id, consultation.patientId))
      .where(eq(consultation.id, consultationId));
    if (!row) throw new Error(`consultation ${consultationId} not found for its attempt`);
    return row;
  },

  /** Serialises breaker decisions for one lender until the TX ends. */
  async lockBreaker(tx: Tx, lender: LenderCode): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`breaker:${lender}`}))`);
  },

  /** The lender's NORMAL, called, settled attempts since `since`, newest first (≤ `limit`). */
  breakerSamples(
    executor: DbOrTx,
    lender: LenderCode,
    since: Date,
    limit: number,
  ): Promise<BreakerSample[]> {
    return executor
      .select({
        status: lenderAttempt.status,
        reason: lenderAttempt.reason,
        calledAt: sql<Date>`${lenderAttempt.calledAt}`.mapWith(lenderAttempt.calledAt),
        settledAt: sql<Date>`${lenderAttempt.settledAt}`.mapWith(lenderAttempt.settledAt),
      })
      .from(lenderAttempt)
      .where(
        and(
          eq(lenderAttempt.lender, lender),
          eq(lenderAttempt.simulationScenario, "NORMAL"),
          isNotNull(lenderAttempt.calledAt),
          isNotNull(lenderAttempt.settledAt),
          gte(lenderAttempt.settledAt, since),
        ),
      )
      .orderBy(desc(lenderAttempt.settledAt))
      .limit(limit);
  },

  /** Whether a half-open probe for `lender` was called after `since` and hasn't settled. */
  async probeInFlight(tx: Tx, lender: LenderCode, since: Date): Promise<boolean> {
    const [row] = await tx
      .select({ id: lenderAttempt.id })
      .from(lenderAttempt)
      .where(
        and(
          eq(lenderAttempt.lender, lender),
          eq(lenderAttempt.breakerProbe, true),
          isNull(lenderAttempt.settledAt),
          gt(lenderAttempt.calledAt, since),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  async markCalled(tx: Tx, id: string, breakerProbe: boolean): Promise<void> {
    await tx
      .update(lenderAttempt)
      .set({ calledAt: sql`clock_timestamp()`, breakerProbe })
      .where(pending(id));
  },

  /** Guarded on PENDING: undefined when someone else (the finalizer) settled it first. */
  async settle(
    tx: Tx,
    id: string,
    settlement: AttemptSettlement,
  ): Promise<LenderAttemptRow | undefined> {
    const [row] = await tx
      .update(lenderAttempt)
      .set({ ...settlement, settledAt: sql`clock_timestamp()` })
      .where(pending(id))
      .returning();
    return row;
  },

  /** Times out every PENDING attempt of a consultation; returns how many changed. */
  async timeoutPending(tx: Tx, consultationId: string): Promise<number> {
    const rows = await tx
      .update(lenderAttempt)
      .set({ status: "UNAVAILABLE", reason: "TIMEOUT", settledAt: sql`clock_timestamp()` })
      .where(
        and(eq(lenderAttempt.consultationId, consultationId), eq(lenderAttempt.status, "PENDING")),
      )
      .returning({ id: lenderAttempt.id });
    return rows.length;
  },

  async countPending(tx: Tx, consultationId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lenderAttempt)
      .where(
        and(eq(lenderAttempt.consultationId, consultationId), eq(lenderAttempt.status, "PENDING")),
      );
    return row?.count ?? 0;
  },

  /** Every attempt of a consultation, as stored (backoffice detail, test assertions). */
  listByConsultation(consultationId: string, executor: DbOrTx = db): Promise<LenderAttemptRow[]> {
    return executor
      .select()
      .from(lenderAttempt)
      .where(eq(lenderAttempt.consultationId, consultationId));
  },
};
