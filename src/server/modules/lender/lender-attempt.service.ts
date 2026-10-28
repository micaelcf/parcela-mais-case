import { LENDER_CODES, type LenderCode, type SimulationScenario } from "#/lib/enums";
import { db, type DbOrTx, type Tx } from "#/server/infra/db/client";
import { notifyConsultationUpdated } from "#/server/infra/realtime/consultation-events";
import { LenderCallError, type LenderResult } from "#/server/integrations/lenders/lender.port";
import type { LenderRegistry } from "#/server/integrations/lenders/registry";
import { logger } from "#/server/lib/log/logger";
import { consultationService } from "#/server/modules/consultation/consultation.service";
import { patientService } from "#/server/modules/patient/patient.service";
import { pricingService } from "#/server/modules/pricing/pricing.service";

import { BREAKER, type BreakerState, breakerState } from "./circuit-breaker";
import {
  type AttemptCallContext,
  type AttemptSettlement,
  type LenderAttemptRow,
  lenderAttemptRepository,
} from "./lender-attempt.repository";
import { lenderSettingService } from "./lender-setting.service";

/** The answer of a real call, as it will be settled. */
type CallOutcome = { result: LenderResult } | { error: LenderCallError };

/** Gate decision taken under the lender's advisory lock. */
type Gate =
  | { kind: "SKIP"; reason: "DISABLED" | "CIRCUIT_OPEN" }
  | { kind: "CALL"; probe: boolean };

async function breakerOf(executor: DbOrTx, lender: LenderCode, now: Date): Promise<BreakerState> {
  const samples = await lenderAttemptRepository.breakerSamples(
    executor,
    lender,
    new Date(now.getTime() - BREAKER.windowMs),
    BREAKER.windowSize,
  );
  return breakerState(samples, now);
}

/**
 * Kill switch, then breaker (one half-open probe at a time). Runs under the advisory lock.
 * The breaker is derived from NORMAL traffic and governs NORMAL traffic only: forced-scenario
 * attempts are never counted, never probe and are never blocked by it (RFC D11, 2026-10-28), so a
 * forced scenario holds its outcome whatever real traffic did to the circuit. The kill switch
 * still applies to them.
 */
async function decideGate(tx: Tx, attempt: LenderAttemptRow, now: Date): Promise<Gate> {
  const { lender } = attempt;
  if (!(await lenderSettingService.isEnabled(tx, lender)))
    return { kind: "SKIP", reason: "DISABLED" };
  if (attempt.simulationScenario !== "NORMAL") return { kind: "CALL", probe: false };
  const state = await breakerOf(tx, lender, now);
  if (state === "OPEN") return { kind: "SKIP", reason: "CIRCUIT_OPEN" };
  if (state === "HALF_OPEN") {
    const since = new Date(now.getTime() - BREAKER.openMs);
    if (await lenderAttemptRepository.probeInFlight(tx, lender, since)) {
      return { kind: "SKIP", reason: "CIRCUIT_OPEN" };
    }
    return { kind: "CALL", probe: true };
  }
  return { kind: "CALL", probe: false };
}

function settlementOf(outcome: CallOutcome, latencyMs: number): AttemptSettlement {
  if ("error" in outcome) {
    return { status: "UNAVAILABLE", reason: outcome.error.reason, latencyMs };
  }
  const { result } = outcome;
  if (result.kind === "APPROVED") {
    return {
      status: "APPROVED",
      reason: null,
      approvedCents: result.approvedCents,
      monthlyRate: result.monthlyRate,
      latencyMs,
    };
  }
  return {
    status: "REFUSED",
    reason: result.reason,
    maxApprovableCents: result.maxApprovableCents,
    latencyMs,
  };
}

/** Guarded settle + offers + consultation settle + NOTIFY, in the caller's TX. False if lost. */
async function settleInTx(
  tx: Tx,
  attempt: LenderAttemptRow,
  settlement: AttemptSettlement,
  approved?: { requestedCents: number; termsMonths: readonly number[] },
): Promise<boolean> {
  const settled = await lenderAttemptRepository.settle(tx, attempt.id, settlement);
  if (!settled) return false;
  if (approved && settled.approvedCents !== null && settled.monthlyRate !== null) {
    await pricingService.createOffers(tx, {
      attemptId: settled.id,
      consultationId: settled.consultationId,
      lender: settled.lender,
      requestedCents: approved.requestedCents,
      approvedCents: settled.approvedCents,
      monthlyRate: settled.monthlyRate,
      termsMonths: approved.termsMonths,
    });
  }
  await consultationService.settleIfComplete(tx, settled.consultationId);
  await notifyConsultationUpdated(tx, settled.consultationId);
  return true;
}

export const lenderAttemptService = {
  /** The four PENDING attempts of a new consultation (create TX). */
  createPending(tx: Tx, consultationId: string, scenario: SimulationScenario) {
    return lenderAttemptRepository.insertPending(tx, consultationId, scenario);
  },

  /** Finalizer: every PENDING attempt → UNAVAILABLE/TIMEOUT; returns how many changed. */
  timeoutPending(tx: Tx, consultationId: string): Promise<number> {
    return lenderAttemptRepository.timeoutPending(tx, consultationId);
  },

  countPending(tx: Tx, consultationId: string): Promise<number> {
    return lenderAttemptRepository.countPending(tx, consultationId);
  },

  /** Every lender's breaker state now (backoffice lender health). */
  async breakerStates(now: Date = new Date()): Promise<Record<LenderCode, BreakerState>> {
    const [ALFA, BETA, GAMA, DELTA] = await Promise.all(
      LENDER_CODES.map((lender) => breakerOf(db, lender, now)),
    );
    return { ALFA, BETA, GAMA, DELTA };
  },

  /**
   * The lender job (`boundaries.md` § Lender job): pick → gate → call outside any TX, bounded by
   * the consultation deadline → guarded settle. Lender failures are answers, never job failures;
   * unexpected errors throw and leave the attempt to the finalizer.
   *
   * The gate is double-checked: a plain call on a CLOSED breaker needs no lock (a call racing the
   * circuit opening is no different from one that arrived a moment earlier), so only a skip or a
   * half-open probe is re-decided under the lender's advisory lock. Concurrent attempts of one
   * lender therefore don't queue on the lock in the common case.
   */
  async run(attemptId: string, registry: LenderRegistry): Promise<void> {
    const claimed = await db.transaction(async (tx) => {
      const attempt = await lenderAttemptRepository.pick(tx, attemptId);
      if (!attempt) return null;
      let gate = await decideGate(tx, attempt, new Date());
      if (gate.kind === "SKIP" || gate.probe) {
        await lenderAttemptRepository.lockBreaker(tx, attempt.lender);
        gate = await decideGate(tx, attempt, new Date());
      }
      if (gate.kind === "SKIP") {
        await settleInTx(tx, attempt, { status: "UNAVAILABLE", reason: gate.reason });
        return null;
      }
      await lenderAttemptRepository.markCalled(tx, attempt.id, gate.probe);
      const context = await lenderAttemptRepository.callContext(tx, attempt.consultationId);
      return { attempt, context };
    });
    if (!claimed) return;

    const { attempt, context } = claimed;
    const port = registry[attempt.lender];
    const startedAt = performance.now();
    const outcome = await callLender(attempt, context, port.preApprove.bind(port));
    const latencyMs = Math.round(performance.now() - startedAt);
    const settlement = settlementOf(outcome, latencyMs);
    logger.info("lender.call", {
      lender: attempt.lender,
      attemptId: attempt.id,
      latencyMs,
      outcome: settlement.status,
      reason: settlement.reason,
    });

    await db.transaction((tx) =>
      settleInTx(
        tx,
        attempt,
        settlement,
        "result" in outcome && outcome.result.kind === "APPROVED"
          ? {
              requestedCents: context.treatmentAmountCents,
              termsMonths: outcome.result.termsMonths,
            }
          : undefined,
      ),
    );
  },
};

async function callLender(
  attempt: LenderAttemptRow,
  context: AttemptCallContext,
  preApprove: LenderRegistry[LenderCode]["preApprove"],
): Promise<CallOutcome> {
  try {
    const result = await preApprove(
      {
        attemptId: attempt.id,
        cpf: patientService.revealCpf(context),
        ageYears: context.ageYears,
        monthlyIncomeCents: context.monthlyIncomeCents,
        treatmentAmountCents: context.treatmentAmountCents,
        scenario: attempt.simulationScenario,
      },
      AbortSignal.timeout(context.remainingMs),
    );
    return { result };
  } catch (error) {
    if (error instanceof LenderCallError) return { error };
    throw error;
  }
}
