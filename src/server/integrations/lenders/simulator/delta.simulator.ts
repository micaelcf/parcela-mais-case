import Type, { type Static } from "typebox";

import {
  CpfDigitsSchema,
  FAILURE_REPLY,
  type LenderAnswers,
  ScenarioSchema,
  type SimulatorReply,
} from "./scenario";

/** Delta `POST /delta/credit-check`: `amount` in cents. */
export const DeltaRequestSchema = Type.Object({
  taxId: CpfDigitsSchema,
  amount: Type.Integer({ minimum: 1 }),
  scenario: ScenarioSchema,
});
export type DeltaRequest = Static<typeof DeltaRequestSchema>;

const approve = (body: DeltaRequest): SimulatorReply => ({
  status: 200,
  body: {
    decision: "accept",
    amount: body.amount,
    monthlyRatePct: 2.19,
    installments: [12, 24, 36],
  },
});

/** Rule: HTTP 500 with probability `deltaFailureRate`, else approve 100 %. */
export const deltaAnswers: LenderAnswers<DeltaRequest> = {
  RULE: (body, { deltaFailureRate, random }) =>
    random() < deltaFailureRate ? FAILURE_REPLY : approve(body),
  APPROVE: approve,
  REFUSE: () => ({ status: 200, body: { decision: "reject", reason: "risk" } }),
  FAIL: () => FAILURE_REPLY,
};
