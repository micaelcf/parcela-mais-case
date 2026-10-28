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

/** When the newest failing Delta call that opened the circuit started (ms epoch). */
let lastFailedCallAt: number | null = null;

/** Opens Delta's circuit with 20 failing NORMAL consultations, unless an earlier test did. */
async function openDeltaCircuit(): Promise<number> {
  if (lastFailedCallAt !== null) return lastFailedCallAt;
  const ids = await Promise.all(
    Array.from({ length: BREAKER.windowSize }, () => createConsultation({}, "NORMAL")),
  );
  await Promise.all(ids.map((id) => waitSettled(id)));
  const deltas = await Promise.all(ids.map(deltaAttemptOf));
  for (const delta of deltas) {
    expect(delta.status).toBe("UNAVAILABLE");
    expect(delta.calledAt).not.toBeNull();
  }
  expect((await lenderAttemptService.breakerStates()).DELTA).toBe("OPEN");
  lastFailedCallAt = Math.max(...deltas.map((delta) => delta.calledAt?.getTime() ?? 0));
  return lastFailedCallAt;
}

describe("Delta circuit breaker", () => {
  it("skips a lender whose circuit is open", async () => {
    await openDeltaCircuit();

    const id = await createConsultation({}, "NORMAL");
    await waitSettled(id);

    const delta = await deltaAttemptOf(id);
    expect(delta).toMatchObject({ status: "UNAVAILABLE", reason: "CIRCUIT_OPEN", calledAt: null });
  });

  it(
    "lets exactly one probe through after 30 s",
    // Waits out the 30 s open period on purpose (RF-217).
    { timeout: 90_000 },
    async () => {
      const openedAt = await openDeltaCircuit();
      await sleep(Math.max(0, openedAt + BREAKER.openMs + 500 - Date.now()));
      expect((await lenderAttemptService.breakerStates()).DELTA).toBe("HALF_OPEN");

      const ids = await Promise.all([
        createConsultation({}, "NORMAL"),
        createConsultation({}, "NORMAL"),
      ]);
      await Promise.all(ids.map((id) => waitSettled(id)));

      const deltas = await Promise.all(ids.map(deltaAttemptOf));
      const probes = deltas.filter((delta) => delta.breakerProbe);
      expect(probes).toHaveLength(1);
      expect(probes[0]?.calledAt).not.toBeNull();
      const skipped = deltas.filter((delta) => !delta.breakerProbe);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({
        status: "UNAVAILABLE",
        reason: "CIRCUIT_OPEN",
        calledAt: null,
      });
    },
  );
});
