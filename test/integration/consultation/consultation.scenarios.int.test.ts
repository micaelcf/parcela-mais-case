import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { LenderCode, SimulationScenario } from "#/lib/enums";
import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import { createConsultation, waitSettled } from "./consultation-client";

const RUNS = 20;

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

const attemptOf = (view: ConsultationPublicView, lender: LenderCode) =>
  view.attempts.find((attempt) => attempt.lender === lender);

/** What each forced scenario guarantees for every single consultation (RF-214). */
type ForcedScenario = Exclude<SimulationScenario, "NORMAL">;

const FORCED: readonly ForcedScenario[] = [
  "ALL_APPROVE",
  "DELTA_FAILS",
  "DELTA_TIMES_OUT",
  "NONE_APPROVE",
];

const GUARANTEES: Record<ForcedScenario, (view: ConsultationPublicView) => void> = {
  ALL_APPROVE: (view) => {
    expect(view.attempts.map((attempt) => attempt.status)).toEqual([
      "APPROVED",
      "APPROVED",
      "APPROVED",
      "APPROVED",
    ]);
  },
  DELTA_FAILS: (view) => {
    expect(attemptOf(view, "DELTA")).toMatchObject({
      status: "UNAVAILABLE",
      reason: "LENDER_ERROR",
    });
  },
  DELTA_TIMES_OUT: (view) => {
    expect(attemptOf(view, "DELTA")).toMatchObject({ status: "UNAVAILABLE", reason: "TIMEOUT" });
  },
  NONE_APPROVE: (view) => {
    expect(view.offers).toEqual([]);
    expect(view.journeyStatus).toBe("NO_OFFER");
  },
};

describe("forced scenarios", () => {
  it("each forced scenario holds 20 of 20", async () => {
    for (const scenario of FORCED) {
      // One scenario at a time, its 20 consultations concurrently.
      const ids = await Promise.all(
        Array.from({ length: RUNS }, () => createConsultation({}, scenario)),
      );
      const views = await Promise.all(ids.map((id) => waitSettled(id)));
      expect(views).toHaveLength(RUNS);
      for (const view of views) {
        expect(view.simulationScenario).toBe(scenario);
        GUARANTEES[scenario](view);
      }
    }
  });
});
