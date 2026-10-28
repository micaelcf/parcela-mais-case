import { Elysia } from "elysia";

import type { LenderCode, SimulationScenario } from "#/lib/enums";
import { env } from "#/server/infra/env/server-env";

import { AlfaRequestSchema, alfaAnswers } from "./alfa.simulator";
import { BetaRequestSchema, betaAnswers } from "./beta.simulator";
import { DeltaRequestSchema, deltaAnswers } from "./delta.simulator";
import { GamaRequestSchema, gamaAnswers } from "./gama.simulator";
import { drawLatencyMs, sleepUnlessAborted } from "./latency";
import { type LenderAnswers, scenarioBehaviour, type SimulatorContext } from "./scenario";

export type SimulatorOptions = {
  timeScale: number;
  deltaFailureRate: number;
  random?: () => number;
};

/** nginx's "client closed request": the caller aborted before the simulated latency elapsed. */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The four simulated lenders (`api.md` § Lender simulator): each waits its scenario latency
 * × `timeScale` (stopping early when the caller aborts), then answers per `scenario.ts`.
 */
export function createSimulatorPlugin(opts: SimulatorOptions) {
  const context: SimulatorContext = {
    deltaFailureRate: opts.deltaFailureRate,
    random: opts.random ?? Math.random,
  };

  async function answer<Body>(
    lender: LenderCode,
    scenario: SimulationScenario,
    body: Body,
    signal: AbortSignal,
    answers: LenderAnswers<Body>,
  ): Promise<Response> {
    const behaviour = scenarioBehaviour(lender, scenario);
    const latencyMs = drawLatencyMs(behaviour.latency, opts.timeScale, context.random);
    if (!(await sleepUnlessAborted(latencyMs, signal))) {
      return new Response(null, { status: CLIENT_CLOSED_REQUEST });
    }
    const reply = answers[behaviour.outcome](body, context);
    return Response.json(reply.body, { status: reply.status });
  }

  return new Elysia({ prefix: "/simulator/lenders" })
    .post("/alfa/pre-approvals", { body: AlfaRequestSchema }, ({ body, request }) =>
      answer("ALFA", body.cenario, body, request.signal, alfaAnswers),
    )
    .post("/beta/v2/quotes", { body: BetaRequestSchema }, ({ body, request }) =>
      answer("BETA", body.scenario, body, request.signal, betaAnswers),
    )
    .post("/gama/analises", { body: GamaRequestSchema }, ({ body, request }) =>
      answer("GAMA", body.cenario, body, request.signal, gamaAnswers),
    )
    .post("/delta/credit-check", { body: DeltaRequestSchema }, ({ body, request }) =>
      answer("DELTA", body.scenario, body, request.signal, deltaAnswers),
    );
}

export const simulatorPlugin = createSimulatorPlugin({
  timeScale: env.SIMULATOR_TIME_SCALE,
  deltaFailureRate: env.SIMULATOR_DELTA_FAILURE_RATE,
});
