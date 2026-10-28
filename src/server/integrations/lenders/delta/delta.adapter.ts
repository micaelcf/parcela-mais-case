import Type from "typebox";
import { Compile } from "typebox/compile";

import { decimalToMonthlyRate, postLenderJson, unrecognisedResponse } from "../lender-http";
import type { LenderAdapterDeps, LenderPort, LenderResult } from "../lender.port";

const DeltaApproval = Compile(
  Type.Object({
    decision: Type.Literal("accept"),
    amount: Type.Integer({ minimum: 0 }),
    monthlyRatePct: Type.Number({ minimum: 0 }),
    installments: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
  }),
);

const DeltaRefusal = Compile(
  Type.Object({ decision: Type.Literal("reject"), reason: Type.Literal("risk") }),
);

/** Delta: `amount` in cents, rate as a percent number (`2.19`). */
export function createDeltaAdapter(deps: LenderAdapterDeps): LenderPort {
  return {
    code: "DELTA",
    termsMonths: [12, 24, 36],
    async preApprove(req, signal): Promise<LenderResult> {
      const body = await postLenderJson(
        deps,
        "/delta/credit-check",
        { taxId: req.cpf, amount: req.treatmentAmountCents, scenario: req.scenario },
        signal,
      );
      if (DeltaApproval.Check(body)) {
        return {
          kind: "APPROVED",
          approvedCents: body.amount,
          monthlyRate: decimalToMonthlyRate(body.monthlyRatePct, "PERCENT"),
          termsMonths: body.installments,
        };
      }
      if (DeltaRefusal.Check(body)) {
        return { kind: "REFUSED", reason: "PROFILE_NOT_ELIGIBLE", maxApprovableCents: null };
      }
      throw unrecognisedResponse("DELTA");
    },
  };
}
