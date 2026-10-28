import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";
import { lenderSettingService } from "#/server/modules/lender/lender-setting.service";
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

describe("lender kill switch", () => {
  it("skips a disabled lender without calling it", async () => {
    await lenderSettingService.setEnabled({ lender: "DELTA", enabled: false, actor: "teste" });

    const disabledId = await createConsultation({}, "NORMAL");
    await waitSettled(disabledId);
    expect(await deltaAttemptOf(disabledId)).toMatchObject({
      status: "UNAVAILABLE",
      reason: "DISABLED",
      calledAt: null,
    });

    await lenderSettingService.setEnabled({ lender: "DELTA", enabled: true, actor: "teste" });

    const enabledId = await createConsultation({}, "NORMAL");
    const delta = await waitFor(
      () => deltaAttemptOf(enabledId),
      (row) => row.status !== "PENDING" || row.calledAt !== null,
    );
    expect(delta.calledAt).not.toBeNull();
    expect(delta.reason).not.toBe("DISABLED");
  });
});
