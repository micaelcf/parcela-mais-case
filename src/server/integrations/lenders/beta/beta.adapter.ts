import Type from "typebox";
import { Compile } from "typebox/compile";

import { decimalToMonthlyRate, postLenderJson, unrecognisedResponse } from "../lender-http";
import type { LenderAdapterDeps, LenderPort, LenderResult } from "../lender.port";

const BetaApproval = Compile(
  Type.Object({
    status: Type.Literal("APPROVED"),
    maxAmountCents: Type.Integer({ minimum: 0 }),
    rateBps: Type.Number({ minimum: 0 }),
    terms: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
  }),
);

const BetaRefusal = Compile(
  Type.Object({ status: Type.Literal("DECLINED"), code: Type.Literal("POLICY") }),
);

/** Beta: cents both ways, rate in basis points (`199`). */
export function createBetaAdapter(deps: LenderAdapterDeps): LenderPort {
  return {
    code: "BETA",
    termsMonths: [12, 18, 24],
    async preApprove(req, signal): Promise<LenderResult> {
      const body = await postLenderJson(
        deps,
        "/beta/v2/quotes",
        {
          document: req.cpf,
          requestedAmountCents: req.treatmentAmountCents,
          scenario: req.scenario,
        },
        signal,
      );
      if (BetaApproval.Check(body)) {
        return {
          kind: "APPROVED",
          approvedCents: body.maxAmountCents,
          monthlyRate: decimalToMonthlyRate(body.rateBps, "BPS"),
          termsMonths: body.terms,
        };
      }
      if (BetaRefusal.Check(body)) {
        return { kind: "REFUSED", reason: "PROFILE_NOT_ELIGIBLE", maxApprovableCents: null };
      }
      throw unrecognisedResponse("BETA");
    },
  };
}
