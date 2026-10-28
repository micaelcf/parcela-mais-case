import Type, { type Static } from "typebox";

import {
  CpfDigitsSchema,
  FAILURE_REPLY,
  type LenderAnswers,
  ScenarioSchema,
  type SimulatorReply,
} from "./scenario";

/** Alfa `POST /alfa/pre-approvals`: amounts in BRL decimals. */
export const AlfaRequestSchema = Type.Object({
  cpf: CpfDigitsSchema,
  renda_mensal: Type.Number({ minimum: 0 }),
  valor_solicitado: Type.Number({ exclusiveMinimum: 0 }),
  cenario: ScenarioSchema,
});
export type AlfaRequest = Static<typeof AlfaRequestSchema>;

const toCents = (brl: number) => Math.round(brl * 100);

const approve = (body: AlfaRequest): SimulatorReply => ({
  status: 200,
  body: {
    aprovado: true,
    valor_aprovado: toCents(body.valor_solicitado) / 100,
    taxa_mensal: "2.49",
    prazos: [6, 12, 18],
  },
});

const refuse = (limitCents: number): SimulatorReply => ({
  status: 200,
  body: { aprovado: false, motivo: "RENDA_INSUFICIENTE", limite_maximo: limitCents / 100 },
});

/** Rule: approve 100 % when income × 10 ≥ amount, else refuse with the income × 10 limit. */
export const alfaAnswers: LenderAnswers<AlfaRequest> = {
  RULE: (body) => {
    const limitCents = toCents(body.renda_mensal) * 10;
    return limitCents >= toCents(body.valor_solicitado) ? approve(body) : refuse(limitCents);
  },
  APPROVE: approve,
  REFUSE: (body) => refuse(Math.floor(toCents(body.valor_solicitado) / 2)),
  FAIL: () => FAILURE_REPLY,
};
