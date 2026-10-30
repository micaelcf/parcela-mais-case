import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { BREAKER } from "#/server/modules/lender/circuit-breaker";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { lenderAttemptService } from "#/server/modules/lender/lender-attempt.service";
import { createWorker } from "#/server/worker";

import { createConsultation, waitFor, waitSettled } from "../consultation/consultation-client";
import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";

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

describe("Delta circuit breaker", () => {
  it("ignores forced-scenario failures", async () => {
    const forced = await Promise.all(
      Array.from({ length: BREAKER.windowSize }, () => createConsultation({}, "DELTA_FAILS")),
    );
    await Promise.all(forced.map((id) => waitSettled(id)));
    // A full window of forced failures, each from a real call: forced attempts bypass the breaker
    // and are called. Under load a call may hit the 2 s test deadline before its HTTP 500: still a
    // forced failure, which the breaker must equally ignore (RF-218). The exact LENDER_ERROR outcome
    // of DELTA_FAILS is consultation.scenarios.int.test.ts's claim.
    for (const delta of await Promise.all(forced.map(deltaAttemptOf))) {
      expect(delta.calledAt).not.toBeNull();
      expect(delta.status).toBe("UNAVAILABLE");
      expect(["LENDER_ERROR", "TIMEOUT"]).toContain(delta.reason);
    }
    expect((await lenderAttemptService.breakerStates()).DELTA).toBe("CLOSED");

    const id = await createConsultation({}, "NORMAL");

    const delta = await waitFor(
      () => deltaAttemptOf(id),
      (row) => row.status !== "PENDING" || row.calledAt !== null,
    );
    expect(delta.calledAt).not.toBeNull();
    expect(delta.reason).not.toBe("CIRCUIT_OPEN");
  });
});
