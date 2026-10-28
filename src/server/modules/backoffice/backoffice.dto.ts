import Type, { type Static, type TSchema } from "typebox";

import { BR_STATES, type BrState } from "#/lib/address/address";
import { CpfSchema } from "#/lib/cpf/cpf";
import {
  ATTEMPT_REASONS,
  ATTEMPT_STATUSES,
  LENDER_CODES,
  QUOTE_STATUSES,
  SIMULATION_SCENARIOS,
  type AttemptReason,
  type AttemptStatus,
  type LenderCode,
  type QuoteStatus,
  type SimulationScenario,
} from "#/lib/enums";
import { ListQuerySchema } from "#/lib/list/list-contract";
import {
  JOURNEY_STATUSES,
  journeyStatusOf,
  type JourneyStatus,
} from "#/server/modules/consultation/consultation.dto";

/** Request/response DTOs of the backoffice API (`api.md` § Backoffice) and pure row → DTO mappers. */

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

const LenderSchema = Type.Enum(LENDER_CODES);

// ── Session ────────────────────────────────────────────────────────────────────────────────

export const LoginRequestSchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 100, error: "Informe o usuário" }),
  password: Type.String({ minLength: 1, maxLength: 200, error: "Informe a senha" }),
});
export type LoginRequest = Static<typeof LoginRequestSchema>;

export const SessionSchema = Type.Object({ username: Type.String() });
export type Session = Static<typeof SessionSchema>;

// ── Metrics ────────────────────────────────────────────────────────────────────────────────

export const METRIC_BUCKETS = ["day", "hour"] as const;
export type MetricBucket = (typeof METRIC_BUCKETS)[number];

/** `from` inclusive, `to` exclusive (ISO-8601); both default to the last 24 h. */
export const MetricsRangeQuerySchema = Type.Object({
  from: Type.Optional(Type.String({ maxLength: 40 })),
  to: Type.Optional(Type.String({ maxLength: 40 })),
});
export type MetricsRangeQuery = Static<typeof MetricsRangeQuerySchema>;

export const PipelineQuerySchema = Type.Object({
  ...MetricsRangeQuerySchema.properties,
  bucket: Type.Optional(Type.Enum(METRIC_BUCKETS)),
});
export type PipelineQuery = Static<typeof PipelineQuerySchema>;

export const PipelineBucketSchema = Type.Object({
  bucketStart: Type.String(),
  consultations: Type.Integer(),
  requestedCents: Type.Integer(),
  approvedCents: Type.Integer(),
  chosenCents: Type.Integer(),
});
export type PipelineBucket = Static<typeof PipelineBucketSchema>;

export const PipelineMetricsSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  bucket: Type.Enum(METRIC_BUCKETS),
  /** Every bucket in `[from, to)` in order (UTC), zero-filled. */
  series: Type.Array(PipelineBucketSchema),
  totals: Type.Object({
    consultations: Type.Integer(),
    requestedCents: Type.Integer(),
    approvedCents: Type.Integer(),
    chosenCents: Type.Integer(),
    settledConsultations: Type.Integer(),
    approvedConsultations: Type.Integer(),
    /** Settled consultations with ≥ 1 approval ÷ settled consultations (0–1); null with none settled. */
    approvalRate: Nullable(Type.Number()),
    /** Approved ÷ requested over the settled consultations (0–1); null with none settled. */
    approvedRequestedRatio: Nullable(Type.Number()),
    chosenOffers: Type.Integer(),
    avgChosenInstallmentCents: Nullable(Type.Integer()),
    avgChosenTotalCents: Nullable(Type.Integer()),
  }),
  /** Always the four lenders, in display order. */
  chosenByLender: Type.Array(
    Type.Object({
      lender: LenderSchema,
      chosenOffers: Type.Integer(),
      chosenCents: Type.Integer(),
    }),
  ),
});
export type PipelineMetrics = Static<typeof PipelineMetricsSchema>;

export const BREAKER_STATES = ["CLOSED", "OPEN", "HALF_OPEN"] as const;

export const LenderHealthSchema = Type.Object({
  lender: LenderSchema,
  enabled: Type.Boolean(),
  breaker: Type.Enum(BREAKER_STATES),
  /** Jobs waiting in the lender's queue (pg-boss `queuedCount`). */
  queueBacklog: Type.Integer(),
  settledAttempts: Type.Integer(),
  calledAttempts: Type.Integer(),
  /** `percentile_cont` over the latency of called attempts; null with none. */
  p50LatencyMs: Nullable(Type.Number()),
  p95LatencyMs: Nullable(Type.Number()),
  approved: Type.Integer(),
  refused: Type.Integer(),
  errors: Type.Integer(),
  timeouts: Type.Integer(),
  /** Each count ÷ settled attempts (0–1); null with none settled. */
  approvalRate: Nullable(Type.Number()),
  refusalRate: Nullable(Type.Number()),
  errorRate: Nullable(Type.Number()),
  timeoutRate: Nullable(Type.Number()),
});
export type LenderHealth = Static<typeof LenderHealthSchema>;

export const LenderMetricsSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  lenders: Type.Array(LenderHealthSchema),
});
export type LenderMetrics = Static<typeof LenderMetricsSchema>;

export const LIMIT_CODES = ["IP_LIMIT", "PATIENT_LIMIT"] as const;
export type LimitCode = (typeof LIMIT_CODES)[number];

export const AbuseMetricsSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  /** Counted create/requote requests. */
  requests: Type.Integer(),
  limitHits: Type.Object({ IP_LIMIT: Type.Integer(), PATIENT_LIMIT: Type.Integer() }),
  /** Requests answered 429. */
  tooManyRequests: Type.Integer(),
  /** Patients by consultations created in the range (never the CPF). */
  topPatients: Type.Array(
    Type.Object({
      patientId: Type.String(),
      firstName: Type.String(),
      consultations: Type.Integer(),
    }),
  ),
  /** Client IP hashes by counted requests; `ipHash` = the first 8 hex chars of the HMAC. */
  topIps: Type.Array(
    Type.Object({
      ipHash: Type.String(),
      requests: Type.Integer(),
      tooManyRequests: Type.Integer(),
    }),
  ),
});
export type AbuseMetrics = Static<typeof AbuseMetricsSchema>;

// ── Kill switch ────────────────────────────────────────────────────────────────────────────

/** URL segment → lender code (`/backoffice/lenders/delta/switch`). */
export const LENDER_SLUGS: Record<"alfa" | "beta" | "gama" | "delta", LenderCode> = {
  alfa: "ALFA",
  beta: "BETA",
  gama: "GAMA",
  delta: "DELTA",
};

export const LenderParamsSchema = Type.Object({
  lender: Type.Enum(["alfa", "beta", "gama", "delta"], { error: "Credora desconhecida" }),
});

export const SwitchRequestSchema = Type.Object({ enabled: Type.Boolean() });
export type SwitchRequest = Static<typeof SwitchRequestSchema>;

export const LenderStateSchema = Type.Object({
  lender: LenderSchema,
  enabled: Type.Boolean(),
  updatedAt: Type.String(),
});
export type LenderState = Static<typeof LenderStateSchema>;

export const SwitchLogItemSchema = Type.Object({
  id: Type.String(),
  lender: LenderSchema,
  enabled: Type.Boolean(),
  actor: Type.String(),
  createdAt: Type.String(),
});
export type SwitchLogItem = Static<typeof SwitchLogItemSchema>;

// ── Consultations ──────────────────────────────────────────────────────────────────────────

export const ConsultationListItemSchema = Type.Object({
  id: Type.String(),
  /** The journey status (`api.md` § Public `journeyStatus`). */
  status: Type.Enum(JOURNEY_STATUSES),
  quoteStatus: Type.Enum(QUOTE_STATUSES),
  treatmentAmountCents: Type.Integer(),
  simulationScenario: Type.Enum(SIMULATION_SCENARIOS),
  patientId: Type.String(),
  patientName: Type.String(),
  createdAt: Type.String(),
  settledAt: Nullable(Type.String()),
});
export type ConsultationListItem = Static<typeof ConsultationListItemSchema>;

/**
 * The CPF plus the explorer's list controls (`page`, `pageSize`, `sort`, `q` and its allow-listed
 * filters as top-level keys), all in the POST body so the CPF never reaches a URL.
 */
export const SearchByCpfRequestSchema = Type.Object(
  { cpf: CpfSchema, ...ListQuerySchema.properties },
  // Filters are top-level keys, exactly as `ListQuerySchema` allows them in a query string.
  { additionalProperties: Type.Union([Type.String(), Type.Number()]) },
);
export type SearchByCpfRequest = Static<typeof SearchByCpfRequestSchema>;

export const ConsultationDetailSchema = Type.Object({
  id: Type.String(),
  status: Type.Enum(JOURNEY_STATUSES),
  quoteStatus: Type.Enum(QUOTE_STATUSES),
  simulationScenario: Type.Enum(SIMULATION_SCENARIOS),
  createdAt: Type.String(),
  deadlineAt: Type.String(),
  settledAt: Nullable(Type.String()),
  patient: Type.Object({
    id: Type.String(),
    /** Decrypted: the only endpoint that reveals it. */
    cpf: Type.String(),
    fullName: Type.String(),
    birthdate: Type.String(),
    phone: Type.String(),
    /** The latest address sent; null for patients saved before addresses existed. */
    address: Nullable(
      Type.Object({
        cep: Type.String(),
        street: Type.String(),
        number: Type.String(),
        complement: Nullable(Type.String()),
        neighborhood: Type.String(),
        city: Type.String(),
        state: Type.Enum(BR_STATES),
      }),
    ),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  }),
  /** The inputs frozen at submission. */
  inputs: Type.Object({
    monthlyIncomeCents: Type.Integer(),
    treatmentAmountCents: Type.Integer(),
    birthdate: Type.String(),
    ageYears: Type.Integer(),
  }),
  attempts: Type.Array(
    Type.Object({
      id: Type.String(),
      lender: LenderSchema,
      status: Type.Enum(ATTEMPT_STATUSES),
      reason: Nullable(Type.Enum(ATTEMPT_REASONS)),
      approvedCents: Nullable(Type.Integer()),
      monthlyRate: Nullable(Type.String()),
      maxApprovableCents: Nullable(Type.Integer()),
      breakerProbe: Type.Boolean(),
      createdAt: Type.String(),
      pickedAt: Nullable(Type.String()),
      calledAt: Nullable(Type.String()),
      settledAt: Nullable(Type.String()),
      latencyMs: Nullable(Type.Integer()),
    }),
  ),
  offers: Type.Array(
    Type.Object({
      id: Type.String(),
      lender: LenderSchema,
      approvedCents: Type.Integer(),
      requestedCents: Type.Integer(),
      monthlyRate: Type.String(),
      termMonths: Type.Integer(),
      installmentCents: Type.Integer(),
      totalCents: Type.Integer(),
      createdAt: Type.String(),
    }),
  ),
  choice: Nullable(Type.Object({ offerId: Type.String(), chosenAt: Type.String() })),
});
export type ConsultationDetail = Static<typeof ConsultationDetailSchema>;

// ── Throttle events ────────────────────────────────────────────────────────────────────────

export const THROTTLE_ROUTES = [
  "consultation.create",
  "consultation.requote",
  "address.lookup",
] as const;

export const ThrottleEventItemSchema = Type.Object({
  id: Type.String(),
  route: Type.Enum(THROTTLE_ROUTES),
  /** First 8 hex chars of the client IP's HMAC. */
  ipHash: Type.String(),
  statusCode: Nullable(Type.Integer()),
  errorCode: Nullable(Type.String()),
  createdAt: Type.String(),
});
export type ThrottleEventItem = Static<typeof ThrottleEventItemSchema>;

// ── Mappers ────────────────────────────────────────────────────────────────────────────────

const LENDER_ORDER: Record<LenderCode, number> = { ALFA: 0, BETA: 1, GAMA: 2, DELTA: 3 };

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The first word of a full name (the only identity the abuse view shows). */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function toSwitchLogItem(row: {
  id: string;
  lender: LenderCode;
  enabled: boolean;
  actor: string;
  createdAt: Date;
}): SwitchLogItem {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export function toThrottleEventItem(row: {
  id: string;
  route: (typeof THROTTLE_ROUTES)[number];
  ipHash: string;
  statusCode: number | null;
  errorCode: string | null;
  createdAt: Date;
}): ThrottleEventItem {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export function toConsultationListItem(row: {
  id: string;
  status: JourneyStatus;
  quoteStatus: QuoteStatus;
  treatmentAmountCents: number;
  simulationScenario: SimulationScenario;
  patientId: string;
  patientName: string;
  createdAt: Date;
  settledAt: Date | null;
}): ConsultationListItem {
  return { ...row, createdAt: row.createdAt.toISOString(), settledAt: iso(row.settledAt) };
}

/** The rows the detail is built from (the repository result satisfies this shape). */
export type ConsultationDetailRows = {
  id: string;
  quoteStatus: QuoteStatus;
  simulationScenario: SimulationScenario;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
  birthdate: string;
  ageYears: number;
  createdAt: Date;
  deadlineAt: Date;
  settledAt: Date | null;
  chosenOfferId: string | null;
  chosenAt: Date | null;
  patient: {
    id: string;
    fullName: string;
    birthdate: string;
    phone: string;
    addressCep: string | null;
    addressStreet: string | null;
    addressNumber: string | null;
    addressComplement: string | null;
    addressNeighborhood: string | null;
    addressCity: string | null;
    addressState: BrState | null;
    createdAt: Date;
    updatedAt: Date;
  };
  attempts: ReadonlyArray<{
    id: string;
    lender: LenderCode;
    status: AttemptStatus;
    reason: AttemptReason | null;
    approvedCents: number | null;
    monthlyRate: string | null;
    maxApprovableCents: number | null;
    breakerProbe: boolean;
    createdAt: Date;
    pickedAt: Date | null;
    calledAt: Date | null;
    settledAt: Date | null;
    latencyMs: number | null;
  }>;
  offers: ReadonlyArray<{
    id: string;
    lender: LenderCode;
    approvedCents: number;
    requestedCents: number;
    monthlyRate: string;
    termMonths: number;
    installmentCents: number;
    totalCents: number;
    createdAt: Date;
  }>;
};

/** The stored address columns → the detail's address; null unless every required column is set. */
function addressOf(
  patient: ConsultationDetailRows["patient"],
): ConsultationDetail["patient"]["address"] {
  const {
    addressCep: cep,
    addressStreet: street,
    addressNumber: number,
    addressNeighborhood: neighborhood,
    addressCity: city,
    addressState: state,
  } = patient;
  if (
    cep === null ||
    street === null ||
    number === null ||
    neighborhood === null ||
    city === null ||
    state === null
  ) {
    return null;
  }
  return { cep, street, number, complement: patient.addressComplement, neighborhood, city, state };
}

/** Rows + the decrypted CPF → detail; attempts by lender, offers by lender then term. */
export function toConsultationDetail(
  rows: ConsultationDetailRows,
  cpf: string,
): ConsultationDetail {
  const attempts = [...rows.attempts]
    .sort((a, b) => LENDER_ORDER[a.lender] - LENDER_ORDER[b.lender])
    .map((attempt) => ({
      ...attempt,
      createdAt: attempt.createdAt.toISOString(),
      pickedAt: iso(attempt.pickedAt),
      calledAt: iso(attempt.calledAt),
      settledAt: iso(attempt.settledAt),
    }));
  const offers = [...rows.offers]
    .sort((a, b) => LENDER_ORDER[a.lender] - LENDER_ORDER[b.lender] || a.termMonths - b.termMonths)
    .map((offer) => ({ ...offer, createdAt: offer.createdAt.toISOString() }));
  const choice =
    rows.chosenOfferId && rows.chosenAt
      ? { offerId: rows.chosenOfferId, chosenAt: rows.chosenAt.toISOString() }
      : null;
  return {
    id: rows.id,
    status: journeyStatusOf({
      hasChoice: choice !== null,
      hasOffers: offers.length > 0,
      quoteStatus: rows.quoteStatus,
    }),
    quoteStatus: rows.quoteStatus,
    simulationScenario: rows.simulationScenario,
    createdAt: rows.createdAt.toISOString(),
    deadlineAt: rows.deadlineAt.toISOString(),
    settledAt: iso(rows.settledAt),
    patient: {
      id: rows.patient.id,
      cpf,
      fullName: rows.patient.fullName,
      birthdate: rows.patient.birthdate,
      phone: rows.patient.phone,
      address: addressOf(rows.patient),
      createdAt: rows.patient.createdAt.toISOString(),
      updatedAt: rows.patient.updatedAt.toISOString(),
    },
    inputs: {
      monthlyIncomeCents: rows.monthlyIncomeCents,
      treatmentAmountCents: rows.treatmentAmountCents,
      birthdate: rows.birthdate,
      ageYears: rows.ageYears,
    },
    attempts,
    offers,
    choice,
  };
}
