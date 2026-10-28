import Type, { type Static } from "typebox";

import {
  CpfDigitsSchema,
  FAILURE_REPLY,
  type LenderAnswers,
  ScenarioSchema,
  type SimulatorReply,
} from "./scenario";

/** Gama `POST /gama/analises`: amounts in cents. */
export const GamaRequestSchema = Type.Object({
  paciente: Type.Object({ cpf: CpfDigitsSchema, idade: Type.Integer({ minimum: 0 }) }),
  valorCentavos: Type.Integer({ minimum: 1 }),
  cenario: ScenarioSchema,
});
export type GamaRequest = Static<typeof GamaRequestSchema>;

const MIN_AGE = 25;
const MAX_AMOUNT_CENTS = 2_000_000;

const approve = (body: GamaRequest): SimulatorReply => ({
  status: 200,
  body: {
    resultado: "APROVADO",
    valorCentavos: body.valorCentavos,
    juros: 0.0329,
    parcelas: [6, 10, 12],
  },
});

const refuseAge: SimulatorReply = {
  status: 200,
  body: { resultado: "RECUSADO", regra: "IDADE_MINIMA" },
};

/** Rule: refuse under 25 or above R$ 20.000 (hint: the cap), else approve 100 %. */
export const gamaAnswers: LenderAnswers<GamaRequest> = {
  RULE: (body) => {
    if (body.paciente.idade < MIN_AGE) return refuseAge;
    if (body.valorCentavos > MAX_AMOUNT_CENTS) {
      return {
        status: 200,
        body: { resultado: "RECUSADO", regra: "VALOR_MAXIMO", tetoCentavos: MAX_AMOUNT_CENTS },
      };
    }
    return approve(body);
  },
  APPROVE: approve,
  REFUSE: () => refuseAge,
  FAIL: () => FAILURE_REPLY,
};
