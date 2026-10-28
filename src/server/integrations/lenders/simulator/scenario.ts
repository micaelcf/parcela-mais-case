import Type from "typebox";

import { SIMULATION_SCENARIOS, type LenderCode, type SimulationScenario } from "#/lib/enums";

/** Request fields every simulated lender shares. */
export const ScenarioSchema = Type.Union(SIMULATION_SCENARIOS.map((value) => Type.Literal(value)));
export const CpfDigitsSchema = Type.String({ pattern: "^\\d{11}$" });

export type SimulatorContext = { readonly deltaFailureRate: number; readonly random: () => number };

/** Unscaled latency bounds in ms; the simulator draws uniformly in `[minMs, maxMs]`. */
export type LatencyRange = { readonly minMs: number; readonly maxMs: number };

/**
 * What a lender does under a scenario: `RULE` applies its PDF rule, `APPROVE`/`REFUSE` force
 * the lender's own approval/refusal answer, `FAIL` forces an HTTP 500.
 */
export type SimulatedOutcome = "RULE" | "APPROVE" | "REFUSE" | "FAIL";

export type ScenarioBehaviour = {
  readonly outcome: SimulatedOutcome;
  readonly latency: LatencyRange;
};

/** One HTTP answer of a simulated lender. */
export type SimulatorReply = { readonly status: 200 | 201 | 500; readonly body: object };

/** A lender's answer per outcome (lookup table; `FAIL` is always {@link FAILURE_REPLY}). */
export type LenderAnswers<Body> = Record<
  SimulatedOutcome,
  (body: Body, context: SimulatorContext) => SimulatorReply
>;

export const FAILURE_REPLY: SimulatorReply = { status: 500, body: { error: "internal" } };

/** PDF p.2–3 latencies (`NORMAL`). */
const NORMAL_LATENCY: Record<LenderCode, LatencyRange> = {
  ALFA: { minMs: 500, maxMs: 1_500 },
  BETA: { minMs: 2_000, maxMs: 5_000 },
  GAMA: { minMs: 1_000, maxMs: 3_000 },
  DELTA: { minMs: 4_000, maxMs: 15_000 },
};

type Override = Partial<ScenarioBehaviour>;

/** `boundaries.md` § Scenarios: every cell not listed follows the lender's `NORMAL` behaviour. */
const OVERRIDES: Record<SimulationScenario, Partial<Record<LenderCode, Override>>> = {
  NORMAL: {},
  ALL_APPROVE: {
    ALFA: { outcome: "APPROVE" },
    BETA: { outcome: "APPROVE" },
    GAMA: { outcome: "APPROVE" },
    DELTA: { outcome: "APPROVE", latency: { minMs: 4_000, maxMs: 8_000 } },
  },
  DELTA_FAILS: { DELTA: { outcome: "FAIL" } },
  DELTA_TIMES_OUT: { DELTA: { latency: { minMs: 12_000, maxMs: 15_000 } } },
  NONE_APPROVE: {
    ALFA: { outcome: "REFUSE" },
    BETA: { outcome: "REFUSE" },
    GAMA: { outcome: "REFUSE" },
    DELTA: { outcome: "REFUSE" },
  },
};

export function scenarioBehaviour(
  lender: LenderCode,
  scenario: SimulationScenario,
): ScenarioBehaviour {
  return { outcome: "RULE", latency: NORMAL_LATENCY[lender], ...OVERRIDES[scenario][lender] };
}
