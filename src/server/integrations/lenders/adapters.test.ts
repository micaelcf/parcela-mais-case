import { Elysia } from "elysia";
import { describe, expect, it } from "vite-plus/test";

import type { SimulationScenario } from "#/lib/enums";

import { LenderCallError, type PreApprovalRequest } from "./lender.port";
import { createLenderRegistry } from "./registry";
import { createSimulatorPlugin } from "./simulator/simulator.plugin";

const BASE_URL = "http://localhost/simulator/lenders";

function simulatorRegistry(deltaFailureRate = 0) {
  const simulator = new Elysia().use(createSimulatorPlugin({ timeScale: 0.01, deltaFailureRate }));
  return createLenderRegistry({
    baseUrl: BASE_URL,
    fetch: (input, init) => simulator.handle(new Request(input, init)),
  });
}

function request(
  overrides: Partial<Omit<PreApprovalRequest, "scenario">>,
  scenario: SimulationScenario = "NORMAL",
): PreApprovalRequest {
  return {
    attemptId: "0192f0a0-0000-7000-8000-000000000000",
    cpf: "52998224725",
    ageYears: 40,
    monthlyIncomeCents: 1_000_000,
    treatmentAmountCents: 1_000_001,
    scenario,
    ...overrides,
  };
}

const never = () => new AbortController().signal;

async function expectCallError(
  call: Promise<unknown>,
  reason: LenderCallError["reason"],
): Promise<void> {
  const error = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(LenderCallError);
  expect(error).toMatchObject({ reason });
}

describe("lender adapters", () => {
  it("maps approvals to canonical rates and terms", async () => {
    const registry = simulatorRegistry(0);
    const req = request({
      monthlyIncomeCents: 1_000_000,
      ageYears: 40,
      treatmentAmountCents: 1_000_001,
    });

    const results = Object.fromEntries(
      await Promise.all(
        (["ALFA", "BETA", "GAMA", "DELTA"] as const).map(
          async (code) => [code, await registry[code].preApprove(req, never())] as const,
        ),
      ),
    );

    expect(results).toEqual({
      ALFA: {
        kind: "APPROVED",
        approvedCents: 1_000_001,
        monthlyRate: "0.024900",
        termsMonths: [6, 12, 18],
      },
      BETA: {
        kind: "APPROVED",
        approvedCents: 600_001,
        monthlyRate: "0.019900",
        termsMonths: [12, 18, 24],
      },
      GAMA: {
        kind: "APPROVED",
        approvedCents: 1_000_001,
        monthlyRate: "0.032900",
        termsMonths: [6, 10, 12],
      },
      DELTA: {
        kind: "APPROVED",
        approvedCents: 1_000_001,
        monthlyRate: "0.021900",
        termsMonths: [12, 24, 36],
      },
    });
  });

  it("maps refusals to canonical reasons", async () => {
    const registry = simulatorRegistry(0);

    await expect(
      registry.ALFA.preApprove(
        request({ monthlyIncomeCents: 100_000, treatmentAmountCents: 1_000_001 }),
        never(),
      ),
    ).resolves.toEqual({
      kind: "REFUSED",
      reason: "AMOUNT_ABOVE_LIMIT",
      maxApprovableCents: 1_000_000,
    });
    await expect(
      registry.GAMA.preApprove(request({ ageYears: 40, treatmentAmountCents: 2_000_001 }), never()),
    ).resolves.toEqual({
      kind: "REFUSED",
      reason: "AMOUNT_ABOVE_LIMIT",
      maxApprovableCents: 2_000_000,
    });
    await expect(
      registry.GAMA.preApprove(request({ ageYears: 24, treatmentAmountCents: 100_000 }), never()),
    ).resolves.toEqual({
      kind: "REFUSED",
      reason: "PROFILE_NOT_ELIGIBLE",
      maxApprovableCents: null,
    });
    await expect(registry.BETA.preApprove(request({}, "NONE_APPROVE"), never())).resolves.toEqual({
      kind: "REFUSED",
      reason: "PROFILE_NOT_ELIGIBLE",
      maxApprovableCents: null,
    });
    await expect(registry.DELTA.preApprove(request({}, "NONE_APPROVE"), never())).resolves.toEqual({
      kind: "REFUSED",
      reason: "PROFILE_NOT_ELIGIBLE",
      maxApprovableCents: null,
    });
  });

  it("NONE_APPROVE Alfa hints half the amount", async () => {
    const registry = simulatorRegistry(0);

    const result = await registry.ALFA.preApprove(
      request({ monthlyIncomeCents: 10_000_000, treatmentAmountCents: 1_000_001 }, "NONE_APPROVE"),
      never(),
    );

    expect(result).toEqual({
      kind: "REFUSED",
      reason: "AMOUNT_ABOVE_LIMIT",
      maxApprovableCents: 500_000,
    });
  });

  it("maps a 5xx to LENDER_ERROR", async () => {
    const registry = simulatorRegistry(0);

    await expectCallError(
      registry.DELTA.preApprove(request({}, "DELTA_FAILS"), never()),
      "LENDER_ERROR",
    );
  });

  it("maps an aborted call to TIMEOUT", async () => {
    const registry = simulatorRegistry(0);

    // DELTA_TIMES_OUT at timeScale 0.01 answers after ≥ 120 ms; the deadline fires at 30 ms.
    await expectCallError(
      registry.DELTA.preApprove(request({}, "DELTA_TIMES_OUT"), AbortSignal.timeout(30)),
      "TIMEOUT",
    );
    await expectCallError(registry.ALFA.preApprove(request({}), AbortSignal.abort()), "TIMEOUT");
  });

  it("maps unusable responses to INTEGRATION_ERROR", async () => {
    const stubs: Record<string, typeof fetch> = {
      "network failure": () => Promise.reject(new TypeError("fetch failed")),
      "non-JSON 200": () =>
        Promise.resolve(
          new Response("<html>ok</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        ),
      "unknown 200 shape": () =>
        Promise.resolve(Response.json({ ok: true, value: 1 }, { status: 200 })),
      "4xx": () => Promise.resolve(Response.json({ error: "bad request" }, { status: 400 })),
    };

    for (const fetch of Object.values(stubs)) {
      const registry = createLenderRegistry({ baseUrl: BASE_URL, fetch });
      for (const adapter of Object.values(registry)) {
        await expectCallError(adapter.preApprove(request({}), never()), "INTEGRATION_ERROR");
      }
    }
  });
});
