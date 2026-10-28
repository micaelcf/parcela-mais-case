import Type, { type Static, type TSchema } from "typebox";

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

/** Request/response DTOs of the public consultation API and the pure rows → view mapper. */

export const MIN_AGE_YEARS = 18;
export const MAX_AGE_YEARS = 80;
export const MIN_TREATMENT_CENTS = 100_000;
export const MAX_TREATMENT_CENTS = 5_000_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** A calendar date as `YYYY-MM-DD` in the local time zone. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** Whole years between `birthdate` and `today` (both `YYYY-MM-DD`); null for an invalid date. */
export function ageOn(birthdate: string, today: string): number | null {
  const born = parseIsoDate(birthdate);
  const now = parseIsoDate(today);
  if (!born || !now) return null;
  const hadBirthday = now.month > born.month || (now.month === born.month && now.day >= born.day);
  return now.year - born.year - (hadBirthday ? 0 : 1);
}

function isAdultUpTo80(birthdate: string): boolean {
  const age = ageOn(birthdate, toIsoDate(new Date()));
  return age !== null && age >= MIN_AGE_YEARS && age <= MAX_AGE_YEARS;
}

function isFullName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 120 && trimmed.split(/\s+/).length >= 2;
}

/** Strips every non-digit from a phone number. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function isPhone(value: string): boolean {
  return /^[\d\s()+.-]+$/.test(value) && /^\d{10,11}$/.test(normalizePhone(value));
}

export const ScenarioSchema = Type.Enum(SIMULATION_SCENARIOS);

export const SignupRequestSchema = Type.Object({
  fullName: Type.Refine(Type.String(), isFullName, () => "Informe nome e sobrenome"),
  cpf: CpfSchema,
  birthdate: Type.Refine(
    Type.String(),
    isAdultUpTo80,
    () => "A idade deve estar entre 18 e 80 anos",
  ),
  phone: Type.Refine(Type.String(), isPhone, () => "Informe um celular com DDD"),
  monthlyIncomeCents: Type.Integer({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    error: "Informe a renda mensal",
  }),
  treatmentAmountCents: Type.Integer({
    minimum: MIN_TREATMENT_CENTS,
    maximum: MAX_TREATMENT_CENTS,
    error: "O valor deve estar entre R$ 1.000,00 e R$ 50.000,00",
  }),
  simulationScenario: Type.Optional(ScenarioSchema),
});
export type SignupRequest = Static<typeof SignupRequestSchema>;

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ pattern: UUID.source, error: "Idempotency-Key inválida" }),
});

export const CreatedSchema = Type.Object({ id: Type.String() });
export type Created = Static<typeof CreatedSchema>;

export const ChooseRequestSchema = Type.Object({
  offerId: Type.String({ pattern: UUID.source, error: "Oferta inválida" }),
});
export type ChooseRequest = Static<typeof ChooseRequestSchema>;

export const JOURNEY_STATUSES = ["QUOTING", "OFFERS", "NO_OFFER", "CHOSEN"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const AttemptViewSchema = Type.Object({
  lender: Type.Enum(LENDER_CODES),
  status: Type.Enum(ATTEMPT_STATUSES),
  reason: Nullable(Type.Enum(ATTEMPT_REASONS)),
  approvedCents: Nullable(Type.Integer()),
  monthlyRate: Nullable(Type.String()),
  maxApprovableCents: Nullable(Type.Integer()),
  settledAt: Nullable(Type.String()),
});

export const OfferViewSchema = Type.Object({
  id: Type.String(),
  lender: Type.Enum(LENDER_CODES),
  approvedCents: Type.Integer(),
  requestedCents: Type.Integer(),
  approvedBelowRequested: Type.Boolean(),
  monthlyRate: Type.String(),
  termMonths: Type.Integer(),
  installmentCents: Type.Integer(),
  totalCents: Type.Integer(),
});

export const ConsultationPublicViewSchema = Type.Object({
  id: Type.String(),
  journeyStatus: Type.Enum(JOURNEY_STATUSES),
  quoteStatus: Type.Enum(QUOTE_STATUSES),
  createdAt: Type.String(),
  deadlineAt: Type.String(),
  settledAt: Nullable(Type.String()),
  patientFirstName: Type.String(),
  treatmentAmountCents: Type.Integer(),
  simulationScenario: ScenarioSchema,
  attempts: Type.Array(AttemptViewSchema),
  offers: Type.Array(OfferViewSchema),
  choice: Nullable(Type.Object({ offerId: Type.String(), chosenAt: Type.String() })),
  suggestion: Nullable(Type.Object({ treatmentAmountCents: Type.Integer() })),
});
export type ConsultationPublicView = Static<typeof ConsultationPublicViewSchema>;
export type AttemptView = Static<typeof AttemptViewSchema>;
export type OfferView = Static<typeof OfferViewSchema>;

/** The rows the view is built from (repository results satisfy these shapes). */
export type ConsultationViewRows = {
  consultation: {
    id: string;
    quoteStatus: QuoteStatus;
    createdAt: Date;
    deadlineAt: Date;
    settledAt: Date | null;
    treatmentAmountCents: number;
    simulationScenario: SimulationScenario;
    chosenOfferId: string | null;
    chosenAt: Date | null;
  };
  patientFullName: string;
  attempts: ReadonlyArray<{
    lender: LenderCode;
    status: AttemptStatus;
    reason: AttemptReason | null;
    approvedCents: number | null;
    monthlyRate: string | null;
    maxApprovableCents: number | null;
    settledAt: Date | null;
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
  }>;
};

const LENDER_ORDER: Record<LenderCode, number> = { ALFA: 0, BETA: 1, GAMA: 2, DELTA: 3 };

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** `CHOSEN` with a choice; else `OFFERS` with any offer; else `NO_OFFER` once settled; else `QUOTING`. */
export function journeyStatusOf(input: {
  hasChoice: boolean;
  hasOffers: boolean;
  quoteStatus: QuoteStatus;
}): JourneyStatus {
  if (input.hasChoice) return "CHOSEN";
  if (input.hasOffers) return "OFFERS";
  return input.quoteStatus === "SETTLED" ? "NO_OFFER" : "QUOTING";
}

/** The highest refusal hint that is ≥ the minimum amount and below the requested amount. */
function bestHint(
  attempts: ConsultationViewRows["attempts"],
  requestedCents: number,
): number | null {
  let best: number | null = null;
  for (const attempt of attempts) {
    const hint = attempt.maxApprovableCents;
    if (attempt.status !== "REFUSED" || hint === null) continue;
    if (hint < MIN_TREATMENT_CENTS || hint >= requestedCents) continue;
    if (best === null || hint > best) best = hint;
  }
  return best;
}

/** Rows → `ConsultationPublicView` (contract `api.md`): attempts by lender, offers by lender then term. */
export function toConsultationPublicView(rows: ConsultationViewRows): ConsultationPublicView {
  const { consultation } = rows;
  const attempts = [...rows.attempts]
    .sort((a, b) => LENDER_ORDER[a.lender] - LENDER_ORDER[b.lender])
    .map((attempt) => ({
      lender: attempt.lender,
      status: attempt.status,
      reason: attempt.reason,
      approvedCents: attempt.approvedCents,
      monthlyRate: attempt.monthlyRate,
      maxApprovableCents: attempt.maxApprovableCents,
      settledAt: iso(attempt.settledAt),
    }));
  const offers = [...rows.offers]
    .sort((a, b) => LENDER_ORDER[a.lender] - LENDER_ORDER[b.lender] || a.termMonths - b.termMonths)
    .map((offer) => ({
      id: offer.id,
      lender: offer.lender,
      approvedCents: offer.approvedCents,
      requestedCents: offer.requestedCents,
      approvedBelowRequested: offer.approvedCents < offer.requestedCents,
      monthlyRate: offer.monthlyRate,
      termMonths: offer.termMonths,
      installmentCents: offer.installmentCents,
      totalCents: offer.totalCents,
    }));
  const choice =
    consultation.chosenOfferId && consultation.chosenAt
      ? { offerId: consultation.chosenOfferId, chosenAt: consultation.chosenAt.toISOString() }
      : null;
  const journeyStatus = journeyStatusOf({
    hasChoice: choice !== null,
    hasOffers: offers.length > 0,
    quoteStatus: consultation.quoteStatus,
  });
  const hint =
    journeyStatus === "NO_OFFER"
      ? bestHint(rows.attempts, consultation.treatmentAmountCents)
      : null;

  return {
    id: consultation.id,
    journeyStatus,
    quoteStatus: consultation.quoteStatus,
    createdAt: consultation.createdAt.toISOString(),
    deadlineAt: consultation.deadlineAt.toISOString(),
    settledAt: iso(consultation.settledAt),
    patientFirstName: rows.patientFullName.trim().split(/\s+/)[0] ?? "",
    treatmentAmountCents: consultation.treatmentAmountCents,
    simulationScenario: consultation.simulationScenario,
    attempts,
    offers,
    choice,
    suggestion: hint === null ? null : { treatmentAmountCents: hint },
  };
}
