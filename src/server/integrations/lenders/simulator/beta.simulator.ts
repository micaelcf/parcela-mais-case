import Type, { type Static } from "typebox";

import {
  CpfDigitsSchema,
  FAILURE_REPLY,
  type LenderAnswers,
  ScenarioSchema,
  type SimulatorReply,
} from "./scenario";

/** Beta `POST /beta/v2/quotes`: amounts in cents. */
export const BetaRequestSchema = Type.Object({
  document: CpfDigitsSchema,
  requestedAmountCents: Type.Integer({ minimum: 1 }),
  scenario: ScenarioSchema,
});
export type BetaRequest = Static<typeof BetaRequestSchema>;

/** Rule: always approve `round_half_up(amount × 0.6)` (integer math: ⌊(6a + 5) / 10⌋). */
const approve = (body: BetaRequest): SimulatorReply => ({
  status: 201,
  body: {
    status: "APPROVED",
    maxAmountCents: Math.floor((body.requestedAmountCents * 6 + 5) / 10),
    rateBps: 199,
    terms: [12, 18, 24],
  },
});

export const betaAnswers: LenderAnswers<BetaRequest> = {
  RULE: approve,
  APPROVE: approve,
  REFUSE: () => ({ status: 200, body: { status: "DECLINED", code: "POLICY" } }),
  FAIL: () => FAILURE_REPLY,
};
