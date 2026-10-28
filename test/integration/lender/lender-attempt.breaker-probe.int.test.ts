import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// Every NORMAL Delta call fails. Set before any app module reads the env (dynamic imports below).
process.env.SIMULATOR_DELTA_FAILURE_RATE = "1";

const { BREAKER } = await import("#/server/modules/lender/circuit-breaker");
const { lenderAttemptRepository } =
  await import("#/server/modules/lender/lender-attempt.repository");
const { lenderAttemptService } = await import("#/server/modules/lender/lender-attempt.service");
const { createWorker } = await import("#/server/worker");
const { closeTestApp, testLenderRegistry } = await import("../setup/app-fetch");
const { createConsultation, sleep, waitSettled } =
  await import("../consultation/consultation-client");

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

async function deltaAttemptOf(consultationId: string) {
  const rows = await lenderAttemptRepository.listByConsultation(consultationId);
  const delta = rows.find((row) => row.lender === "DELTA");
  if (!delta) throw new Error("no Delta attempt");
  return delta;
}

describe("Delta circuit breaker and forced scenarios", () => {
  it(
    "never hands the probe to a forced-scenario attempt",
    // Waits out the 30 s open period on purpose (RF-217, RF-218).
    { timeout: 90_000 },
    async () => {
      const ids = await Promise.all(
        Array.from({ length: BREAKER.windowSize }, () => createConsultation({}, "NORMAL")),
      );
      await Promise.all(ids.map((id) => waitSettled(id)));
      const failed = await Promise.all(ids.map(deltaAttemptOf));
      const openedAt = Math.max(...failed.map((delta) => delta.calledAt?.getTime() ?? 0));
      expect((await lenderAttemptService.breakerStates()).DELTA).toBe("OPEN");

      // RF-214 under an open circuit: a forced scenario still gets its forced outcome.
      const whileOpen = await createConsultation({}, "ALL_APPROVE");
      await waitSettled(whileOpen);
      expect(await deltaAttemptOf(whileOpen)).toMatchObject({
        status: "APPROVED",
        breakerProbe: false,
      });
      expect((await lenderAttemptService.breakerStates()).DELTA).toBe("OPEN");

      await sleep(Math.max(0, openedAt + BREAKER.openMs + 500 - Date.now()));
      expect((await lenderAttemptService.breakerStates()).DELTA).toBe("HALF_OPEN");

      // Half-open: the forced attempt is called as a simulation, never as the probe.
      const forcedId = await createConsultation({}, "DELTA_FAILS");
      await waitSettled(forcedId);
      const forced = await deltaAttemptOf(forcedId);
      expect(forced).toMatchObject({
        status: "UNAVAILABLE",
        reason: "LENDER_ERROR",
        breakerProbe: false,
      });
      expect(forced.calledAt).not.toBeNull();
      expect((await lenderAttemptService.breakerStates()).DELTA).toBe("HALF_OPEN");

      const normalId = await createConsultation({}, "NORMAL");
      await waitSettled(normalId);
      const probe = await deltaAttemptOf(normalId);
      expect(probe.breakerProbe).toBe(true);
      expect(probe.calledAt).not.toBeNull();
    },
  );
});
