import { and, asc, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";

import { LENDER_CODES, type LenderCode } from "#/lib/enums";
import { db } from "#/server/infra/db/client";
import { boss, startBoss } from "#/server/infra/queue/boss";
import { lenderQueue } from "#/server/infra/queue/queues";
import { consultation } from "#/server/modules/consultation/db/consultation.table";
import { lenderAttempt } from "#/server/modules/lender/db/lender-attempt.table";
import { patient } from "#/server/modules/patient/db/patient.table";
import { offer } from "#/server/modules/pricing/db/offer.table";
import { requestThrottle } from "#/server/modules/throttle/db/request-throttle.table";

import type { MetricBucket } from "./backoffice.dto";

/** `[from, to)`. */
export type MetricRange = { from: Date; to: Date };

/** Literal units, so the bucket expression is the same SQL text in SELECT and GROUP BY. */
const BUCKET_UNIT: Record<MetricBucket, SQL> = {
  day: sql.raw("'day'"),
  hour: sql.raw("'hour'"),
};

/** `coalesce(sum(x), 0)` as a JS number (Postgres sums bigint into numeric). */
const sumOf = (expression: SQL) => sql<number>`coalesce(sum(${expression}), 0)`.mapWith(Number);
const sumWhere = (expression: SQL, condition: SQL) =>
  sql<number>`coalesce(sum(${expression}) filter (where ${condition}), 0)`.mapWith(Number);
const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** Per consultation, its highest APPROVED amount. */
function bestApproval() {
  return db
    .select({
      consultationId: lenderAttempt.consultationId,
      approvedCents: sql<number>`max(${lenderAttempt.approvedCents})`.as("best_approved_cents"),
    })
    .from(lenderAttempt)
    .where(eq(lenderAttempt.status, "APPROVED"))
    .groupBy(lenderAttempt.consultationId)
    .as("best");
}

const createdIn = (range: MetricRange) =>
  and(gte(consultation.createdAt, range.from), lt(consultation.createdAt, range.to));

/**
 * Backoffice read model for the dashboards (`signatures.md` § Reporting exception): aggregates
 * over other modules' tables, never a write. Every metric reads consultations created in
 * `[from, to)`, or attempts / throttle rows recorded in it.
 */
export const metricsRepository = {
  /** Requested, best-approved and chosen sums per `date_trunc(bucket, created_at)` in UTC. */
  async pipelineSeries(range: MetricRange, bucket: MetricBucket) {
    const best = bestApproval();
    const bucketStart = sql<Date>`date_trunc(${BUCKET_UNIT[bucket]}, ${consultation.createdAt}, 'UTC')`;
    return db
      .select({
        bucketStart: bucketStart.mapWith(consultation.createdAt),
        consultations: sql<number>`count(*)`.mapWith(Number),
        requestedCents: sumOf(sql`${consultation.treatmentAmountCents}`),
        approvedCents: sumOf(sql`${best.approvedCents}`),
        chosenCents: sumOf(sql`${offer.approvedCents}`),
      })
      .from(consultation)
      .leftJoin(best, eq(best.consultationId, consultation.id))
      .leftJoin(offer, eq(offer.id, consultation.chosenOfferId))
      .where(createdIn(range))
      .groupBy(bucketStart)
      .orderBy(bucketStart);
  },

  /** Range totals, the settled-only sums behind the ratios, and the chosen offers' sums. */
  async pipelineTotals(range: MetricRange) {
    const best = bestApproval();
    const settled = sql`${consultation.quoteStatus} = 'SETTLED'`;
    const [row] = await db
      .select({
        consultations: sql<number>`count(*)`.mapWith(Number),
        requestedCents: sumOf(sql`${consultation.treatmentAmountCents}`),
        approvedCents: sumOf(sql`${best.approvedCents}`),
        chosenCents: sumOf(sql`${offer.approvedCents}`),
        settledConsultations: countWhere(settled),
        approvedConsultations: countWhere(sql`${settled} and ${best.approvedCents} is not null`),
        settledRequestedCents: sumWhere(sql`${consultation.treatmentAmountCents}`, settled),
        settledApprovedCents: sumWhere(sql`${best.approvedCents}`, settled),
        chosenOffers: sql<number>`count(${offer.id})`.mapWith(Number),
        chosenInstallmentCents: sumOf(sql`${offer.installmentCents}`),
        chosenTotalCents: sumOf(sql`${offer.totalCents}`),
      })
      .from(consultation)
      .leftJoin(best, eq(best.consultationId, consultation.id))
      .leftJoin(offer, eq(offer.id, consultation.chosenOfferId))
      .where(createdIn(range));
    if (!row) throw new Error("pipeline totals returned no row");
    return row;
  },

  /** Chosen offers per lender (lenders with none are absent). */
  chosenByLender(range: MetricRange) {
    return db
      .select({
        lender: offer.lender,
        chosenOffers: sql<number>`count(*)`.mapWith(Number),
        chosenCents: sumOf(sql`${offer.approvedCents}`),
      })
      .from(consultation)
      .innerJoin(offer, eq(offer.id, consultation.chosenOfferId))
      .where(createdIn(range))
      .groupBy(offer.lender);
  },

  /** Per lender over attempts settled in the range: outcome counts and latency percentiles. */
  lenderOutcomes(range: MetricRange) {
    const called = sql`${lenderAttempt.calledAt} is not null`;
    const unavailableFor = (reasons: SQL) =>
      countWhere(
        sql`${lenderAttempt.status} = 'UNAVAILABLE' and ${lenderAttempt.reason} in ${reasons}`,
      );
    const percentile = (fraction: number) =>
      sql<
        number | null
      >`percentile_cont(${sql.raw(String(fraction))}) within group (order by ${lenderAttempt.latencyMs}) filter (where ${called})`;
    return db
      .select({
        lender: lenderAttempt.lender,
        settledAttempts: sql<number>`count(*)`.mapWith(Number),
        calledAttempts: countWhere(called),
        approved: countWhere(sql`${lenderAttempt.status} = 'APPROVED'`),
        refused: countWhere(sql`${lenderAttempt.status} = 'REFUSED'`),
        errors: unavailableFor(sql`('LENDER_ERROR', 'INTEGRATION_ERROR')`),
        timeouts: unavailableFor(sql`('TIMEOUT')`),
        p50LatencyMs: percentile(0.5),
        p95LatencyMs: percentile(0.95),
      })
      .from(lenderAttempt)
      .where(and(gte(lenderAttempt.settledAt, range.from), lt(lenderAttempt.settledAt, range.to)))
      .groupBy(lenderAttempt.lender);
  },

  /**
   * Jobs waiting in each lender queue (pg-boss `queuedCount`). `force` recomputes instead of
   * serving the monitor's cache, though pg-boss still reuses a count computed in the last minute.
   */
  async queueBacklog(): Promise<Record<LenderCode, number>> {
    await startBoss();
    const [ALFA, BETA, GAMA, DELTA] = await Promise.all(
      LENDER_CODES.map(async (lender) => {
        const [stats] = await boss.getQueueStats(lenderQueue(lender), { force: true });
        return stats?.queuedCount ?? 0;
      }),
    );
    return { ALFA, BETA, GAMA, DELTA };
  },

  /** Counted consultation requests, limit hits per code and 429 answers recorded in the range. */
  async throttleSummary(range: MetricRange) {
    const [row] = await db
      .select({
        requests: sql<number>`count(*)`.mapWith(Number),
        ipLimit: countWhere(sql`${requestThrottle.errorCode} = 'IP_LIMIT'`),
        patientLimit: countWhere(sql`${requestThrottle.errorCode} = 'PATIENT_LIMIT'`),
        tooManyRequests: countWhere(sql`${requestThrottle.statusCode} = 429`),
      })
      .from(requestThrottle)
      .where(throttleIn(range));
    if (!row) throw new Error("throttle summary returned no row");
    return row;
  },

  /** IP hashes (first 8 hex chars) by counted consultation requests, most first. */
  topIps(range: MetricRange, limit: number) {
    const requests = sql<number>`count(*)`.mapWith(Number);
    return db
      .select({
        ipHash: sql<string>`left(encode(${requestThrottle.ipHmac}, 'hex'), 8)`,
        requests,
        tooManyRequests: countWhere(sql`${requestThrottle.statusCode} = 429`),
      })
      .from(requestThrottle)
      .where(throttleIn(range))
      .groupBy(requestThrottle.ipHmac)
      .orderBy(desc(requests), asc(requestThrottle.ipHmac))
      .limit(limit);
  },

  /** Patients by consultations created in the range, most first (id + name, never the CPF). */
  topPatients(range: MetricRange, limit: number) {
    const consultations = sql<number>`count(*)`.mapWith(Number);
    return db
      .select({ patientId: consultation.patientId, fullName: patient.fullName, consultations })
      .from(consultation)
      .innerJoin(patient, eq(patient.id, consultation.patientId))
      .where(createdIn(range))
      .groupBy(consultation.patientId, patient.fullName)
      .orderBy(desc(consultations), asc(consultation.patientId))
      .limit(limit);
  },
};

/**
 * Abuse figures cover the consultation routes only (RF-614). CEP lookups are ordinary signup
 * traffic, one or more per signup, and would swamp them; the throttle-events list shows them.
 */
const ABUSE_ROUTES = ["consultation.create", "consultation.requote"] as const;

function throttleIn(range: MetricRange) {
  return and(
    gte(requestThrottle.createdAt, range.from),
    lt(requestThrottle.createdAt, range.to),
    inArray(requestThrottle.route, [...ABUSE_ROUTES]),
  );
}
