import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { decimalToMonthlyRate, postLenderJson, unrecognisedResponse } from "../lender-http";
import type { LenderAdapterDeps, LenderPort, LenderResult } from "../lender.port";

const GamaApproval = Compile(
  Type.Object({
    resultado: Type.Literal("APROVADO"),
    valorCentavos: Type.Integer({ minimum: 0 }),
    juros: Type.Number({ minimum: 0 }),
    parcelas: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
  }),
);

const GamaRule = Type.Union([Type.Literal("IDADE_MINIMA"), Type.Literal("VALOR_MAXIMO")]);

const GamaRefusal = Compile(
  Type.Object({
    resultado: Type.Literal("RECUSADO"),
    regra: GamaRule,
    tetoCentavos: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
);

type RefusalReason = Extract<LenderResult, { kind: "REFUSED" }>["reason"];

const REASON_BY_RULE: Record<Static<typeof GamaRule>, RefusalReason> = {
  IDADE_MINIMA: "PROFILE_NOT_ELIGIBLE",
  VALOR_MAXIMO: "AMOUNT_ABOVE_LIMIT",
};

/** Gama: cents both ways, rate as a fraction (`0.0329`). */
export function createGamaAdapter(deps: LenderAdapterDeps): LenderPort {
  return {
    code: "GAMA",
    termsMonths: [6, 10, 12],
    async preApprove(req, signal): Promise<LenderResult> {
      const body = await postLenderJson(
        deps,
        "/gama/analises",
        {
          paciente: { cpf: req.cpf, idade: req.ageYears },
          valorCentavos: req.treatmentAmountCents,
          cenario: req.scenario,
        },
        signal,
      );
      if (GamaApproval.Check(body)) {
        return {
          kind: "APPROVED",
          approvedCents: body.valorCentavos,
          monthlyRate: decimalToMonthlyRate(body.juros, "FRACTION"),
          termsMonths: body.parcelas,
        };
      }
      if (GamaRefusal.Check(body)) {
        const reason = REASON_BY_RULE[body.regra];
        return {
          kind: "REFUSED",
          reason,
          maxApprovableCents: reason === "AMOUNT_ABOVE_LIMIT" ? (body.tetoCentavos ?? null) : null,
        };
      }
      throw unrecognisedResponse("GAMA");
    },
  };
}
