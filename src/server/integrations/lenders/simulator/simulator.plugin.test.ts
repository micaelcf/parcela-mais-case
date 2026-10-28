import { Elysia } from "elysia";
import { describe, expect, it } from "vite-plus/test";

import type { LenderCode, SimulationScenario } from "#/lib/enums";

import { createSimulatorPlugin, type SimulatorOptions } from "./simulator.plugin";

const CPF = "52998224725";

type Applicant = { incomeCents: number; ageYears: number; amountCents: number };

/** Each lender's own HTTP contract (`api.md` § Lender simulator). */
const CONTRACTS: Record<
  LenderCode,
  { path: string; body: (applicant: Applicant, scenario: SimulationScenario) => object }
> = {
  ALFA: {
    path: "/alfa/pre-approvals",
    body: (a, cenario) => ({
      cpf: CPF,
      renda_mensal: a.incomeCents / 100,
      valor_solicitado: a.amountCents / 100,
      cenario,
    }),
  },
  BETA: {
    path: "/beta/v2/quotes",
    body: (a, scenario) => ({ document: CPF, requestedAmountCents: a.amountCents, scenario }),
  },
  GAMA: {
    path: "/gama/analises",
    body: (a, cenario) => ({
      paciente: { cpf: CPF, idade: a.ageYears },
      valorCentavos: a.amountCents,
      cenario,
    }),
  },
  DELTA: {
    path: "/delta/credit-check",
    body: (a, scenario) => ({ taxId: CPF, amount: a.amountCents, scenario }),
  },
};

function mountSimulator(opts: Partial<SimulatorOptions> = {}) {
  const app = new Elysia().use(
    createSimulatorPlugin({ timeScale: 0.01, deltaFailureRate: 0.3, ...opts }),
  );
  return async (
    lender: LenderCode,
    applicant: Applicant,
    scenario: SimulationScenario = "NORMAL",
    signal?: AbortSignal,
  ) => {
    const contract = CONTRACTS[lender];
    const response = await app.handle(
      new Request(`http://localhost/simulator/lenders${contract.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contract.body(applicant, scenario)),
        signal,
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };
}

/** Deterministic PRNG (mulberry32) so rate assertions don't flake. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function timed<T>(run: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  const result = await run();
  return { result, elapsedMs: performance.now() - start };
}

describe("lender simulator", () => {
  it("Alfa approves at income × 10 and refuses one cent above", async () => {
    const call = mountSimulator();

    const atLimit = await call("ALFA", {
      incomeCents: 100_000,
      ageYears: 40,
      amountCents: 1_000_000,
    });
    expect(atLimit).toEqual({
      status: 200,
      body: { aprovado: true, valor_aprovado: 10_000, taxa_mensal: "2.49", prazos: [6, 12, 18] },
    });

    const above = await call("ALFA", {
      incomeCents: 100_000,
      ageYears: 40,
      amountCents: 1_000_001,
    });
    expect(above).toEqual({
      status: 200,
      body: { aprovado: false, motivo: "RENDA_INSUFICIENTE", limite_maximo: 10_000 },
    });
  });

  it("Beta approves 60% rounded half up", async () => {
    const call = mountSimulator();
    const applicant = { incomeCents: 1, ageYears: 18 };

    const odd = await call("BETA", { ...applicant, amountCents: 100_001 });
    expect(odd).toEqual({
      status: 201,
      body: { status: "APPROVED", maxAmountCents: 60_001, rateBps: 199, terms: [12, 18, 24] },
    });

    const round = await call("BETA", { ...applicant, amountCents: 1_000_000 });
    expect(round.status).toBe(201);
    expect(round.body).toMatchObject({ status: "APPROVED", maxAmountCents: 600_000 });
  });

  it("Gama refuses under 25 or above 20.000 reais", async () => {
    const call = mountSimulator();
    const income = { incomeCents: 10_000_000 };

    expect(await call("GAMA", { ...income, ageYears: 24, amountCents: 100_000 })).toEqual({
      status: 200,
      body: { resultado: "RECUSADO", regra: "IDADE_MINIMA" },
    });
    expect(await call("GAMA", { ...income, ageYears: 40, amountCents: 2_000_001 })).toEqual({
      status: 200,
      body: { resultado: "RECUSADO", regra: "VALOR_MAXIMO", tetoCentavos: 2_000_000 },
    });
    expect(await call("GAMA", { ...income, ageYears: 25, amountCents: 2_000_000 })).toEqual({
      status: 200,
      body: {
        resultado: "APROVADO",
        valorCentavos: 2_000_000,
        juros: 0.0329,
        parcelas: [6, 10, 12],
      },
    });
  });

  it("Delta fails about 30% of NORMAL calls", async () => {
    const call = mountSimulator({ deltaFailureRate: 0.3, random: seededRandom(20_261_028) });
    const applicant = { incomeCents: 1, ageYears: 18, amountCents: 345_678 };

    const replies = await Promise.all(Array.from({ length: 200 }, () => call("DELTA", applicant)));

    const failures = replies.filter((reply) => reply.status === 500);
    expect(failures.length / 200).toBeGreaterThanOrEqual(0.23);
    expect(failures.length / 200).toBeLessThanOrEqual(0.37);
    for (const failure of failures) expect(failure.body).toEqual({ error: "internal" });
    for (const reply of replies.filter((r) => r.status !== 500)) {
      expect(reply).toEqual({
        status: 200,
        body: {
          decision: "accept",
          amount: 345_678,
          monthlyRatePct: 2.19,
          installments: [12, 24, 36],
        },
      });
    }
  });

  it("applies the scaled latency", async () => {
    const call = mountSimulator({ timeScale: 0.1 });

    const { result, elapsedMs } = await timed(() =>
      call("ALFA", { incomeCents: 100_000, ageYears: 40, amountCents: 100_000 }),
    );

    expect(result.status).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(50);
    expect(elapsedMs).toBeLessThanOrEqual(200);
  });

  it("forced scenarios override every lender", async () => {
    // Would be refused by Alfa (income × 10 < amount) and Gama (age < 25, amount > cap).
    const ineligible = { incomeCents: 10_000, ageYears: 20, amountCents: 3_000_000 };
    // Would be approved by every lender under NORMAL rules.
    const eligible = { incomeCents: 1_000_000, ageYears: 40, amountCents: 100_000 };

    // ALL_APPROVE: four approvals (Beta at 60 %), even with Delta's failure rate at 100 %.
    const allApprove = mountSimulator({ deltaFailureRate: 1 });
    expect(await allApprove("ALFA", ineligible, "ALL_APPROVE")).toEqual({
      status: 200,
      body: { aprovado: true, valor_aprovado: 30_000, taxa_mensal: "2.49", prazos: [6, 12, 18] },
    });
    expect(await allApprove("BETA", ineligible, "ALL_APPROVE")).toEqual({
      status: 201,
      body: { status: "APPROVED", maxAmountCents: 1_800_000, rateBps: 199, terms: [12, 18, 24] },
    });
    expect(await allApprove("GAMA", ineligible, "ALL_APPROVE")).toEqual({
      status: 200,
      body: {
        resultado: "APROVADO",
        valorCentavos: 3_000_000,
        juros: 0.0329,
        parcelas: [6, 10, 12],
      },
    });
    expect(await allApprove("DELTA", ineligible, "ALL_APPROVE")).toEqual({
      status: 200,
      body: {
        decision: "accept",
        amount: 3_000_000,
        monthlyRatePct: 2.19,
        installments: [12, 24, 36],
      },
    });

    // NONE_APPROVE: four refusals, even for an applicant every rule approves.
    const noneApprove = mountSimulator({ deltaFailureRate: 1 });
    expect(await noneApprove("ALFA", eligible, "NONE_APPROVE")).toEqual({
      status: 200,
      body: { aprovado: false, motivo: "RENDA_INSUFICIENTE", limite_maximo: 500 },
    });
    expect(await noneApprove("BETA", eligible, "NONE_APPROVE")).toEqual({
      status: 200,
      body: { status: "DECLINED", code: "POLICY" },
    });
    expect(await noneApprove("GAMA", eligible, "NONE_APPROVE")).toEqual({
      status: 200,
      body: { resultado: "RECUSADO", regra: "IDADE_MINIMA" },
    });
    expect(await noneApprove("DELTA", eligible, "NONE_APPROVE")).toEqual({
      status: 200,
      body: { decision: "reject", reason: "risk" },
    });

    // DELTA_FAILS / DELTA_TIMES_OUT: Alfa, Beta and Gama keep their NORMAL rule.
    const reliable = mountSimulator({ deltaFailureRate: 0 });
    for (const scenario of ["DELTA_FAILS", "DELTA_TIMES_OUT"] as const) {
      for (const lender of ["ALFA", "BETA", "GAMA"] as const) {
        for (const applicant of [ineligible, eligible]) {
          expect(await reliable(lender, applicant, scenario)).toEqual(
            await reliable(lender, applicant, "NORMAL"),
          );
        }
      }
    }

    // DELTA_FAILS: Delta answers 500 on 20/20 calls, even with a 0 % failure rate.
    const deltaFails = await Promise.all(
      Array.from({ length: 20 }, () => reliable("DELTA", eligible, "DELTA_FAILS")),
    );
    expect(deltaFails.map((reply) => reply.status)).toEqual(Array.from({ length: 20 }, () => 500));

    // DELTA_TIMES_OUT: Delta waits at least 12 000 ms × timeScale (0.01).
    const { elapsedMs } = await timed(() => reliable("DELTA", eligible, "DELTA_TIMES_OUT"));
    expect(elapsedMs).toBeGreaterThanOrEqual(120);
  });

  it("stops sleeping when the caller aborts", async () => {
    // Delta DELTA_TIMES_OUT at timeScale 0.1 would sleep 1 200–1 500 ms.
    const call = mountSimulator({ timeScale: 0.1 });
    const controller = new AbortController();

    const pending = call(
      "DELTA",
      { incomeCents: 1, ageYears: 40, amountCents: 100_000 },
      "DELTA_TIMES_OUT",
      controller.signal,
    );
    // Real time on purpose: the claim is about the handler's real sleep reacting to the abort.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const abortedAt = performance.now();
    controller.abort();
    await pending;

    expect(performance.now() - abortedAt).toBeLessThan(100);
  });
});
