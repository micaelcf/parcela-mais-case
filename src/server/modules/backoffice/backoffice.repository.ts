import { and, count, eq, sql } from "drizzle-orm";

import { LENDER_CODES, QUOTE_STATUSES, SIMULATION_SCENARIOS } from "#/lib/enums";
import { db } from "#/server/infra/db/client";
import {
  type ListSpec,
  listClauses,
  type ParsedListQuery,
  parseFilter,
} from "#/server/infra/db/list-query";
import { consultation } from "#/server/modules/consultation/db/consultation.table";
import {
  JOURNEY_STATUSES,
  type JourneyStatus,
} from "#/server/modules/consultation/consultation.dto";
import { lenderSwitchLog } from "#/server/modules/lender/db/lender-switch-log.table";
import { patient } from "#/server/modules/patient/db/patient.table";
import { offer } from "#/server/modules/pricing/db/offer.table";
import { requestThrottle } from "#/server/modules/throttle/db/request-throttle.table";

import { THROTTLE_ROUTES } from "./backoffice.dto";

/** `journeyStatus` in SQL (same rule as `journeyStatusOf`), so the list can filter and sort on it. */
const journeyStatus = sql<JourneyStatus>`case
  when ${consultation.chosenOfferId} is not null then 'CHOSEN'
  when exists (select 1 from ${offer} where ${offer.consultationId} = ${consultation.id}) then 'OFFERS'
  when ${consultation.quoteStatus} = 'SETTLED' then 'NO_OFFER'
  else 'QUOTING' end`;

/** The first 8 hex chars of the client IP's HMAC: enough to correlate, never the IP. */
const ipHash = sql<string>`left(encode(${requestThrottle.ipHmac}, 'hex'), 8)`;

const shortText =
  (pattern: RegExp) =>
  (raw: string): string | undefined =>
    pattern.test(raw) ? raw : undefined;

/** Allow-lists of the consultation explorer. The CPF is in none of them. */
export const consultationListSpec: ListSpec = {
  filters: {
    status: { column: journeyStatus, kind: "eq", parse: parseFilter.oneOf(JOURNEY_STATUSES) },
    quoteStatus: {
      column: consultation.quoteStatus,
      kind: "eq",
      parse: parseFilter.oneOf(QUOTE_STATUSES),
    },
    simulationScenario: {
      column: consultation.simulationScenario,
      kind: "eq",
      parse: parseFilter.oneOf(SIMULATION_SCENARIOS),
    },
    patientId: { column: consultation.patientId, kind: "eq", parse: parseFilter.uuid() },
    createdAt: { column: consultation.createdAt, kind: "range", parse: parseFilter.instant() },
    treatmentAmountCents: {
      column: consultation.treatmentAmountCents,
      kind: "range",
      parse: parseFilter.integer(),
    },
  },
  sorts: {
    createdAt: consultation.createdAt,
    treatmentAmountCents: consultation.treatmentAmountCents,
    settledAt: consultation.settledAt,
    status: journeyStatus,
  },
  search: [patient.fullName, consultation.id],
  defaultSort: "createdAt:desc",
  tiebreaker: consultation.id,
};

export const switchLogListSpec: ListSpec = {
  filters: {
    lender: { column: lenderSwitchLog.lender, kind: "eq", parse: parseFilter.oneOf(LENDER_CODES) },
    enabled: { column: lenderSwitchLog.enabled, kind: "eq", parse: parseFilter.boolean() },
    actor: { column: lenderSwitchLog.actor, kind: "eq", parse: shortText(/^.{1,100}$/) },
    createdAt: { column: lenderSwitchLog.createdAt, kind: "range", parse: parseFilter.instant() },
  },
  sorts: { createdAt: lenderSwitchLog.createdAt, lender: lenderSwitchLog.lender },
  search: [lenderSwitchLog.actor],
  defaultSort: "createdAt:desc",
  tiebreaker: lenderSwitchLog.id,
};

export const throttleEventListSpec: ListSpec = {
  filters: {
    route: { column: requestThrottle.route, kind: "eq", parse: parseFilter.oneOf(THROTTLE_ROUTES) },
    statusCode: { column: requestThrottle.statusCode, kind: "eq", parse: parseFilter.integer() },
    errorCode: {
      column: requestThrottle.errorCode,
      kind: "eq",
      parse: shortText(/^[A-Z_]{1,40}$/),
    },
    ipHash: { column: ipHash, kind: "eq", parse: shortText(/^[0-9a-f]{8}$/) },
    createdAt: { column: requestThrottle.createdAt, kind: "range", parse: parseFilter.instant() },
  },
  sorts: { createdAt: requestThrottle.createdAt, statusCode: requestThrottle.statusCode },
  search: [requestThrottle.errorCode, requestThrottle.route],
  defaultSort: "createdAt:desc",
  tiebreaker: requestThrottle.id,
};

/**
 * Backoffice read model for the tables and the consultation detail (`signatures.md` § Reporting
 * exception): reads other modules' tables, never writes. Paging, sorting, filtering and search
 * all run in SQL through the shared list engine.
 */
export const backofficeRepository = {
  /** Consultations without any CPF column; `cpfHmac` scopes the page to one patient. */
  async listConsultations(parsed: ParsedListQuery, scope: { cpfHmac?: Buffer } = {}) {
    const clauses = listClauses(parsed, consultationListSpec);
    const where = and(
      clauses.where,
      scope.cpfHmac ? eq(patient.cpfHmac, scope.cpfHmac) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      db
        .select({
          id: consultation.id,
          status: journeyStatus,
          quoteStatus: consultation.quoteStatus,
          treatmentAmountCents: consultation.treatmentAmountCents,
          simulationScenario: consultation.simulationScenario,
          patientId: consultation.patientId,
          patientName: patient.fullName,
          createdAt: consultation.createdAt,
          settledAt: consultation.settledAt,
        })
        .from(consultation)
        .innerJoin(patient, eq(patient.id, consultation.patientId))
        .where(where)
        .orderBy(...clauses.orderBy)
        .limit(clauses.limit)
        .offset(clauses.offset),
      db
        .select({ total: count() })
        .from(consultation)
        .innerJoin(patient, eq(patient.id, consultation.patientId))
        .where(where),
    ]);
    return { rows, total: counted?.total ?? 0 };
  },

  async listSwitchLog(parsed: ParsedListQuery) {
    const clauses = listClauses(parsed, switchLogListSpec);
    const [rows, [counted]] = await Promise.all([
      db
        .select({
          id: lenderSwitchLog.id,
          lender: lenderSwitchLog.lender,
          enabled: lenderSwitchLog.enabled,
          actor: lenderSwitchLog.actor,
          createdAt: lenderSwitchLog.createdAt,
        })
        .from(lenderSwitchLog)
        .where(clauses.where)
        .orderBy(...clauses.orderBy)
        .limit(clauses.limit)
        .offset(clauses.offset),
      db.select({ total: count() }).from(lenderSwitchLog).where(clauses.where),
    ]);
    return { rows, total: counted?.total ?? 0 };
  },

  async listThrottleEvents(parsed: ParsedListQuery) {
    const clauses = listClauses(parsed, throttleEventListSpec);
    const [rows, [counted]] = await Promise.all([
      db
        .select({
          id: requestThrottle.id,
          route: requestThrottle.route,
          ipHash,
          statusCode: requestThrottle.statusCode,
          errorCode: requestThrottle.errorCode,
          createdAt: requestThrottle.createdAt,
        })
        .from(requestThrottle)
        .where(clauses.where)
        .orderBy(...clauses.orderBy)
        .limit(clauses.limit)
        .offset(clauses.offset),
      db.select({ total: count() }).from(requestThrottle).where(clauses.where),
    ]);
    return { rows, total: counted?.total ?? 0 };
  },

  /** The consultation with its patient (sealed CPF included), attempts and offers. */
  findConsultationDetail(id: string) {
    return db.query.consultation.findFirst({
      where: { id },
      with: { patient: true, attempts: true, offers: true },
    });
  },
};
