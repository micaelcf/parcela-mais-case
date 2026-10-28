# Lender port

`src/server/integrations/lenders/lender.port.ts`, the only interface the core knows. Adapters translate a lender's HTTP contract (`api.md` § Lender simulator) into these types. They never decide business outcomes beyond mapping.

```ts
export type LenderCode = "ALFA" | "BETA" | "GAMA" | "DELTA"; // from pgEnum lender_code

export type PreApprovalRequest = {
  attemptId: string;
  cpf: string; // 11 digits; adapters send it only to the lender
  ageYears: number;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
  scenario: SimulationScenario; // forwarded to the simulator; ignored by real lenders
};

export type LenderResult =
  | { kind: "APPROVED"; approvedCents: number; monthlyRate: string; termsMonths: number[] }
  | {
      kind: "REFUSED";
      reason: "AMOUNT_ABOVE_LIMIT" | "PROFILE_NOT_ELIGIBLE";
      maxApprovableCents: number | null;
    };

export class LenderCallError extends Error {
  constructor(
    readonly reason: "LENDER_ERROR" | "TIMEOUT" | "INTEGRATION_ERROR",
    readonly retryable: boolean, // D10: no retries today; carried for a future opt-in
    message: string,
  );
}

export interface LenderPort {
  readonly code: LenderCode;
  readonly termsMonths: readonly number[]; // static catalogue, PDF table
  preApprove(req: PreApprovalRequest, signal: AbortSignal): Promise<LenderResult>; // throws LenderCallError
}

export type LenderAdapterDeps = { baseUrl: string; fetch: typeof fetch };
export function createAlfaAdapter(deps: LenderAdapterDeps): LenderPort; // likewise Beta, Gama, Delta
```

## Mapping rules (every adapter)

| Situation                                     | Result                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2xx with a recognised approve payload         | `APPROVED` with cents (convert BRL decimals → cents half-up), `monthlyRate` normalised to a 6-decimal string (`2.49` % → `"0.024900"`; `199` bps → `"0.019900"`; `0.0329` → `"0.032900"`; `2.19` % → `"0.021900"`), terms from the payload |
| 2xx with a recognised refuse payload          | `REFUSED` + canonical reason + hint cents when present                                                                                                                                                                                     |
| HTTP 5xx                                      | throw `LenderCallError("LENDER_ERROR", true)`                                                                                                                                                                                              |
| `signal` aborted (deadline)                   | throw `LenderCallError("TIMEOUT", false)`                                                                                                                                                                                                  |
| network failure, non-JSON, unknown shape, 4xx | throw `LenderCallError("INTEGRATION_ERROR", false)`                                                                                                                                                                                        |

Reason mapping: Alfa `RENDA_INSUFICIENTE` → `AMOUNT_ABOVE_LIMIT` (hint `limite_maximo`). Gama `VALOR_MAXIMO` → `AMOUNT_ABOVE_LIMIT` (hint `tetoCentavos`), `IDADE_MINIMA` → `PROFILE_NOT_ELIGIBLE` (no hint). Beta `POLICY` and Delta `risk` → `PROFILE_NOT_ELIGIBLE`.

Adapter tests: `fetch = (input, init) => simulator.handle(new Request(input, init))`, with the simulator plugin mounted standalone (`new Elysia().use(simulatorPlugin)`).

## Lender catalogue (PDF p.2–3)

| Lender | Latency (NORMAL) | Rule                                                                                                         | Rate a.m. | Terms      |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------ | --------- | ---------- |
| ALFA   | 0.5–1.5 s        | approve 100 % if `income × 10 ≥ amount`, else refuse (hint `income × 10`)                                    | 2.49 %    | 6, 12, 18  |
| BETA   | 2–5 s            | always approve `round_half_up(amount × 0.6)`                                                                 | 1.99 %    | 12, 18, 24 |
| GAMA   | 1–3 s            | refuse if `age < 25` (`PROFILE_NOT_ELIGIBLE`) or `amount > 2_000_000` (hint `2_000_000`); else approve 100 % | 3.29 %    | 6, 10, 12  |
| DELTA  | 4–15 s           | with probability `SIMULATOR_DELTA_FAILURE_RATE` (0.3) → 500; else approve 100 %                              | 2.19 %    | 12, 24, 36 |

Latency = uniform random in the range × `SIMULATOR_TIME_SCALE`. The simulator honours its own request `signal` (stops sleeping when the caller aborts).
