import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { SimulationScenario } from "#/lib/enums";
import { consultationRepository } from "#/server/modules/consultation/consultation.repository";
import { createWorker } from "#/server/worker";

import { closeTestApp, testLenderRegistry } from "../setup/app-fetch";
import {
  birthdateTurning,
  createConsultation,
  postRequote,
  readCreatedId,
  readProblem,
  readView,
  uniqueCpf,
  waitSettled,
} from "./consultation-client";

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

async function storedRow(id: string) {
  const row = await consultationRepository.findById(id);
  if (!row) throw new Error(`consultation ${id} not stored`);
  return row;
}

/** A consultation of R$ 12.000,00 in `scenario`, once every lender has answered. */
async function settledSource(scenario: SimulationScenario) {
  const id = await createConsultation({ treatmentAmountCents: 1_200_000 }, scenario);
  await waitSettled(id);
  return storedRow(id);
}

describe("requote", () => {
  it("requotes for the same patient with a lower amount", async () => {
    const sourceId = await createConsultation(
      {
        cpf: uniqueCpf(),
        birthdate: birthdateTurning(37),
        monthlyIncomeCents: 432_100,
        treatmentAmountCents: 1_200_000,
      },
      "NONE_APPROVE",
    );
    expect((await waitSettled(sourceId)).journeyStatus).toBe("NO_OFFER");

    const response = await postRequote(sourceId, { treatmentAmountCents: 600_000 });
    expect(response.status).toBe(202);
    const requotedId = await readCreatedId(response);
    expect(requotedId).not.toBe(sourceId);

    const source = await storedRow(sourceId);
    const requoted = await storedRow(requotedId);
    expect(requoted.patientId).toBe(source.patientId);
    expect(requoted.monthlyIncomeCents).toBe(source.monthlyIncomeCents);
    expect(requoted.monthlyIncomeCents).toBe(432_100);
    expect(requoted.birthdate).toBe(source.birthdate);
    expect(requoted.birthdate).toBe(birthdateTurning(37));
    expect(requoted.ageYears).toBe(37);
    expect(requoted.treatmentAmountCents).toBe(600_000);
    expect((await readView(requotedId)).treatmentAmountCents).toBe(600_000);
  });

  const refusals: Array<
    [name: string, source: () => Promise<{ id: string; patientId: string }>, amount: number]
  > = [
    [
      "the source is still quoting",
      async () =>
        storedRow(await createConsultation({ treatmentAmountCents: 1_200_000 }, "DELTA_TIMES_OUT")),
      600_000,
    ],
    ["the source has an approval", () => settledSource("ALL_APPROVE"), 600_000],
    ["the amount isn't lower", () => settledSource("NONE_APPROVE"), 1_200_000],
  ];

  it.each(refusals)(
    "refuses a requote that isn't allowed when %s",
    async (_name, source, treatmentAmountCents) => {
      const { id, patientId } = await source();
      const before = await consultationRepository.countByPatient(patientId);

      const response = await postRequote(id, { treatmentAmountCents });
      expect(response.status).toBe(409);
      expect((await readProblem(response)).code).toBe("REQUOTE_NOT_ALLOWED");
      expect(await consultationRepository.countByPatient(patientId)).toBe(before);
    },
  );

  it("replays a requote with the same Idempotency-Key", async () => {
    const source = await settledSource("NONE_APPROVE");
    const key = randomUUID();

    const first = await postRequote(source.id, { treatmentAmountCents: 500_000 }, { key });
    const second = await postRequote(source.id, { treatmentAmountCents: 500_000 }, { key });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await readCreatedId(second)).toBe(await readCreatedId(first));
    // The source plus exactly one requoted consultation.
    expect(await consultationRepository.countByPatient(source.patientId)).toBe(2);
  });

  it("requotes in NORMAL by default", async () => {
    const source = await settledSource("NONE_APPROVE");
    expect(source.simulationScenario).toBe("NONE_APPROVE");

    const requotedId = await readCreatedId(
      await postRequote(source.id, { treatmentAmountCents: 500_000 }),
    );
    expect((await storedRow(requotedId)).simulationScenario).toBe("NORMAL");
    expect((await readView(requotedId)).simulationScenario).toBe("NORMAL");
  });
});
