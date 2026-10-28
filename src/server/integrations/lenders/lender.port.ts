import type { LenderCode, SimulationScenario } from "#/lib/enums";

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
  override readonly name = "LenderCallError";

  constructor(
    readonly reason: "LENDER_ERROR" | "TIMEOUT" | "INTEGRATION_ERROR",
    readonly retryable: boolean, // D10: no retries today; carried for a future opt-in
    message: string,
  ) {
    super(message);
  }
}

export interface LenderPort {
  readonly code: LenderCode;
  readonly termsMonths: readonly number[]; // static catalogue, PDF table
  preApprove(req: PreApprovalRequest, signal: AbortSignal): Promise<LenderResult>; // throws LenderCallError
}

export type LenderAdapterDeps = { baseUrl: string; fetch: typeof fetch };
