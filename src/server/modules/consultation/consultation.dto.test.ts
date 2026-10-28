import { describe, expect, it } from "vite-plus/test";

import type { AttemptReason, AttemptStatus, LenderCode, QuoteStatus } from "#/lib/enums";

import { type ConsultationViewRows, toConsultationPublicView } from "./consultation.dto";

const CREATED = new Date("2026-10-28T12:00:00.000Z");

type AttemptRow = ConsultationViewRows["attempts"][number];
type OfferRow = ConsultationViewRows["offers"][number];

function attempt(
  lender: LenderCode,
  status: AttemptStatus,
  reason: AttemptReason | null = null,
  maxApprovableCents: number | null = null,
): AttemptRow {
  const approved = status === "APPROVED";
  return {
    lender,
    status,
    reason,
    approvedCents: approved ? 1_000_000 : null,
    monthlyRate: approved ? "0.024900" : null,
    maxApprovableCents,
    settledAt: status === "PENDING" ? null : CREATED,
  };
}

function offer(lender: LenderCode, termMonths: number): OfferRow {
  return {
    id: `0190f0a0-0000-7000-8000-${String(termMonths).padStart(12, "0")}`,
    lender,
    approvedCents: 1_000_000,
    requestedCents: 1_000_000,
    monthlyRate: "0.024900",
    termMonths,
    installmentCents: 97_428,
    totalCents: 1_169_136,
  };
}

function rows(input: {
  quoteStatus: QuoteStatus;
  attempts: AttemptRow[];
  offers?: OfferRow[];
  chosenOfferId?: string | null;
  treatmentAmountCents?: number;
}): ConsultationViewRows {
  return {
    consultation: {
      id: "0190f0a0-0000-7000-8000-000000000001",
      quoteStatus: input.quoteStatus,
      createdAt: CREATED,
      deadlineAt: new Date(CREATED.getTime() + 10_000),
      settledAt: input.quoteStatus === "SETTLED" ? CREATED : null,
      treatmentAmountCents: input.treatmentAmountCents ?? 1_000_000,
      simulationScenario: "NORMAL",
      chosenOfferId: input.chosenOfferId ?? null,
      chosenAt: input.chosenOfferId ? CREATED : null,
    },
    patientFullName: "Maria da Silva",
    attempts: input.attempts,
    offers: input.offers ?? [],
  };
}

const allRefused = (hints: Array<number | null>): AttemptRow[] =>
  (["ALFA", "BETA", "GAMA", "DELTA"] as const).map((lender, index) =>
    attempt(lender, "REFUSED", "AMOUNT_ABOVE_LIMIT", hints[index] ?? null),
  );

describe("consultation public view", () => {
  it("derives the journey status", () => {
    const alfaOffer = offer("ALFA", 12);

    const chosen = rows({
      quoteStatus: "QUOTING",
      attempts: [attempt("ALFA", "APPROVED"), attempt("DELTA", "PENDING")],
      offers: [alfaOffer],
      chosenOfferId: alfaOffer.id,
    });
    expect(toConsultationPublicView(chosen).journeyStatus).toBe("CHOSEN");

    const offers = rows({
      quoteStatus: "QUOTING",
      attempts: [attempt("ALFA", "APPROVED"), attempt("DELTA", "PENDING")],
      offers: [alfaOffer],
    });
    expect(toConsultationPublicView(offers).journeyStatus).toBe("OFFERS");

    const noOffer = rows({ quoteStatus: "SETTLED", attempts: allRefused([]) });
    expect(toConsultationPublicView(noOffer).journeyStatus).toBe("NO_OFFER");

    const quoting = rows({
      quoteStatus: "QUOTING",
      attempts: [attempt("ALFA", "REFUSED", "AMOUNT_ABOVE_LIMIT"), attempt("BETA", "PENDING")],
    });
    expect(toConsultationPublicView(quoting).journeyStatus).toBe("QUOTING");
  });

  it("suggests the highest usable hint", () => {
    // Hints at or above the requested amount and below the 100 000 minimum are unusable.
    const mixed = rows({
      quoteStatus: "SETTLED",
      treatmentAmountCents: 1_000_000,
      attempts: allRefused([500_000, 700_000, 1_000_000, 99_999]),
    });
    expect(toConsultationPublicView(mixed).suggestion).toEqual({ treatmentAmountCents: 700_000 });

    const atMinimum = rows({
      quoteStatus: "SETTLED",
      treatmentAmountCents: 1_000_000,
      attempts: allRefused([100_000, null, null, null]),
    });
    expect(toConsultationPublicView(atMinimum).suggestion).toEqual({
      treatmentAmountCents: 100_000,
    });

    const noUsableHint = rows({
      quoteStatus: "SETTLED",
      treatmentAmountCents: 1_000_000,
      attempts: allRefused([1_200_000, 99_999, null, null]),
    });
    expect(toConsultationPublicView(noUsableHint).suggestion).toBeNull();

    const withOffer = rows({
      quoteStatus: "SETTLED",
      treatmentAmountCents: 1_000_000,
      attempts: [
        attempt("ALFA", "REFUSED", "AMOUNT_ABOVE_LIMIT", 500_000),
        attempt("BETA", "APPROVED"),
      ],
      offers: [offer("BETA", 12)],
    });
    expect(toConsultationPublicView(withOffer).suggestion).toBeNull();
  });
});
