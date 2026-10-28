import { Compile } from "typebox/compile";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { LENDER_CODES, type LenderCode } from "#/lib/enums";
import {
  type ConsultationPublicView,
  ConsultationPublicViewSchema,
} from "#/server/modules/consultation/consultation.dto";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  choose,
  createConsultation,
  readProblem,
  readView,
  waitFor,
  waitSettled,
} from "./consultation-client";

const View = Compile(ConsultationPublicViewSchema);

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

/** Canonical monthly rates (`lender-port.md` § Lender catalogue). */
const RATES: Record<LenderCode, string> = {
  ALFA: "0.024900",
  BETA: "0.019900",
  GAMA: "0.032900",
  DELTA: "0.021900",
};

const attemptStatus = (view: ConsultationPublicView, lender: LenderCode) =>
  view.attempts.find((attempt) => attempt.lender === lender)?.status;

function offerOf(view: ConsultationPublicView, lender: LenderCode, termMonths?: number) {
  const offer = view.offers.find(
    (candidate) =>
      candidate.lender === lender &&
      (termMonths === undefined || candidate.termMonths === termMonths),
  );
  if (!offer) throw new Error(`no ${lender} offer${termMonths ? ` at ${termMonths}x` : ""}`);
  return offer;
}

async function chooseView(id: string, offerId: string) {
  const response = await choose(id, offerId);
  const text = await response.text();
  return {
    status: response.status,
    text,
    view: response.status === 200 ? View.Parse(JSON.parse(text)) : null,
  };
}

/** An ALL_APPROVE consultation of R$ 10.000,00 once all four lenders answered. */
async function settledAllApprove(): Promise<ConsultationPublicView> {
  const id = await createConsultation({ treatmentAmountCents: 1_000_000 }, "ALL_APPROVE");
  return waitSettled(id);
}

describe("offers and choice", () => {
  it("creates one offer per catalogue term", async () => {
    const view = await settledAllApprove();

    for (const lender of LENDER_CODES) {
      const offers = view.offers.filter((offer) => offer.lender === lender);
      expect(offers.map((offer) => offer.termMonths)).toEqual([
        ...testLenderRegistry[lender].termsMonths,
      ]);
      for (const offer of offers) expect(offer.monthlyRate).toBe(RATES[lender]);
    }
  });

  it("prices offers with Tabela Price", async () => {
    const view = await settledAllApprove();

    expect(offerOf(view, "ALFA", 12)).toMatchObject({
      approvedCents: 1_000_000,
      installmentCents: 97_428,
      totalCents: 1_169_136,
    });
  });

  it("flags offers below the requested amount", async () => {
    const view = await settledAllApprove();

    for (const offer of view.offers.filter((candidate) => candidate.lender === "BETA")) {
      expect(offer).toMatchObject({ approvedCents: 600_000, approvedBelowRequested: true });
    }
    for (const offer of view.offers.filter((candidate) => candidate.lender === "ALFA")) {
      expect(offer).toMatchObject({ approvedCents: 1_000_000, approvedBelowRequested: false });
    }
  });

  it("persists a choice", async () => {
    const view = await settledAllApprove();
    const offerId = offerOf(view, "GAMA", 10).id;

    const chosen = await chooseView(view.id, offerId);

    expect(chosen.status).toBe(200);
    expect(chosen.view?.choice?.offerId).toBe(offerId);
    const reloaded = await readView(view.id);
    expect(reloaded.choice).toEqual(chosen.view?.choice);
    expect(reloaded.journeyStatus).toBe("CHOSEN");
  });

  it("allows a choice while lenders are still quoting", async () => {
    const id = await createConsultation({ treatmentAmountCents: 1_000_000 }, "ALL_APPROVE");
    const partial = await waitFor(
      () => readView(id),
      (view) => view.offers.some((offer) => offer.lender === "ALFA"),
    );
    expect(attemptStatus(partial, "DELTA")).toBe("PENDING");

    const chosen = await chooseView(id, offerOf(partial, "ALFA").id);

    expect(chosen.status).toBe(200);
    expect(chosen.view?.quoteStatus).toBe("QUOTING");
    expect(chosen.view && attemptStatus(chosen.view, "DELTA")).toBe("PENDING");
  });

  it("re-choosing the same offer is idempotent", async () => {
    const view = await settledAllApprove();
    const offerId = offerOf(view, "DELTA", 24).id;

    const first = await chooseView(view.id, offerId);
    const second = await chooseView(view.id, offerId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
  });

  it("accepts an offer id in either letter case", async () => {
    const view = await settledAllApprove();
    const offerId = offerOf(view, "BETA", 18).id;

    const upper = await chooseView(view.id, offerId.toUpperCase());
    expect(upper.status).toBe(200);
    // Choosing it again in lower case is the same choice, not a conflict.
    const lower = await chooseView(view.id, offerId);
    expect(lower.status).toBe(200);
    expect(JSON.parse(lower.text)).toMatchObject({ choice: { offerId } });
  });

  it("rejects a different offer after a choice", async () => {
    const [view, other] = await Promise.all([settledAllApprove(), settledAllApprove()]);
    const chosenId = offerOf(view, "ALFA", 6).id;
    expect((await chooseView(view.id, chosenId)).status).toBe(200);

    const conflict = await choose(view.id, offerOf(view, "BETA", 12).id);
    expect(conflict.status).toBe(409);
    expect((await readProblem(conflict)).code).toBe("CHOICE_CONFLICT");
    expect((await readView(view.id)).choice?.offerId).toBe(chosenId);

    const foreign = await choose(view.id, offerOf(other, "ALFA", 6).id);
    expect(foreign.status).toBe(404);
    expect((await readProblem(foreign)).code).toBe("OFFER_NOT_FOUND");
    expect((await readView(view.id)).choice?.offerId).toBe(chosenId);
  });

  it("serialises concurrent choices", async () => {
    const view = await settledAllApprove();
    const offerIds = [offerOf(view, "ALFA", 18).id, offerOf(view, "GAMA", 6).id];

    const results = await Promise.all(offerIds.map((offerId) => chooseView(view.id, offerId)));

    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const winner = results.findIndex((result) => result.status === 200);
    expect((await readView(view.id)).choice?.offerId).toBe(offerIds[winner]);
  });

  it("records late answers without changing the choice", async () => {
    const id = await createConsultation({ treatmentAmountCents: 1_000_000 }, "ALL_APPROVE");
    const partial = await waitFor(
      () => readView(id),
      (view) => view.offers.some((offer) => offer.lender === "ALFA"),
    );
    expect(attemptStatus(partial, "DELTA")).toBe("PENDING");
    const alfaOfferId = offerOf(partial, "ALFA", 12).id;
    expect((await chooseView(id, alfaOfferId)).status).toBe(200);

    const settled = await waitSettled(id);

    expect(attemptStatus(settled, "DELTA")).toBe("APPROVED");
    expect(settled.offers.filter((offer) => offer.lender === "DELTA")).toHaveLength(
      testLenderRegistry.DELTA.termsMonths.length,
    );
    expect(settled.choice?.offerId).toBe(alfaOfferId);
  });
});
