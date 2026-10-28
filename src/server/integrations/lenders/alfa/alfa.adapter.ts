import Type from "typebox";
import { Compile } from "typebox/compile";

import {
  decimalToCents,
  decimalToMonthlyRate,
  postLenderJson,
  unrecognisedResponse,
} from "../lender-http";
import type { LenderAdapterDeps, LenderPort, LenderResult } from "../lender.port";

const BrlDecimal = Type.Union([Type.Number({ minimum: 0 }), Type.String()]);
const Terms = Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 });

const AlfaApproval = Compile(
  Type.Object({
    aprovado: Type.Literal(true),
    valor_aprovado: BrlDecimal,
    taxa_mensal: BrlDecimal,
    prazos: Terms,
  }),
);

const AlfaRefusal = Compile(
  Type.Object({
    aprovado: Type.Literal(false),
    motivo: Type.Literal("RENDA_INSUFICIENTE"),
    limite_maximo: BrlDecimal,
  }),
);

/** Alfa: BRL decimals both ways, rate as a percent string (`"2.49"`). */
export function createAlfaAdapter(deps: LenderAdapterDeps): LenderPort {
  return {
    code: "ALFA",
    termsMonths: [6, 12, 18],
    async preApprove(req, signal): Promise<LenderResult> {
      const body = await postLenderJson(
        deps,
        "/alfa/pre-approvals",
        {
          cpf: req.cpf,
          renda_mensal: req.monthlyIncomeCents / 100,
          valor_solicitado: req.treatmentAmountCents / 100,
          cenario: req.scenario,
        },
        signal,
      );
      if (AlfaApproval.Check(body)) {
        return {
          kind: "APPROVED",
          approvedCents: decimalToCents(body.valor_aprovado),
          monthlyRate: decimalToMonthlyRate(body.taxa_mensal, "PERCENT"),
          termsMonths: body.prazos,
        };
      }
      if (AlfaRefusal.Check(body)) {
        return {
          kind: "REFUSED",
          reason: "AMOUNT_ABOVE_LIMIT",
          maxApprovableCents: decimalToCents(body.limite_maximo),
        };
      }
      throw unrecognisedResponse("ALFA");
    },
  };
}
