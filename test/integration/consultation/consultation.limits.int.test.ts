import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// Must be set before any app module reads the env (dynamic imports below).
process.env.RATE_LIMIT_PATIENT_MAX = "5";
process.env.RATE_LIMIT_PATIENT_WINDOW_HOURS = "24";

const { hashIp } = await import("#/server/lib/crypto/ip-hash");
const { consultationRepository } =
  await import("#/server/modules/consultation/consultation.repository");
const { throttleRepository } = await import("#/server/modules/throttle/throttle.repository");
const { createWorker } = await import("#/server/worker");
const { closeTestApp, testLenderRegistry } = await import("../setup/app-fetch");
const {
  createConsultation,
  postConsultation,
  postRequote,
  readCreatedId,
  readProblem,
  signupBody,
  uniqueCpf,
  uniqueIp,
  waitFor,
  waitSettled,
} = await import("./consultation-client");

const worker = createWorker({ lenderRegistry: testLenderRegistry });
beforeAll(() => worker.start());
afterAll(async () => {
  await worker.stop();
  await closeTestApp();
});

describe("per-patient cap", () => {
  it("refuses a patient over the cap on create and on requote", async () => {
    const cpf = uniqueCpf();
    const sourceId = await createConsultation(
      { cpf, treatmentAmountCents: 1_200_000 },
      "NONE_APPROVE",
    );
    for (let created = 1; created < 5; created += 1) await createConsultation({ cpf });
    const source = await consultationRepository.findById(sourceId);
    if (!source) throw new Error("source not stored");
    expect(await consultationRepository.countByPatient(source.patientId)).toBe(5);

    const sixth = await postConsultation(signupBody({ cpf }));
    expect(sixth.status).toBe(429);
    const problem = await readProblem(sixth);
    expect(problem.code).toBe("PATIENT_LIMIT");
    expect(problem.detail).toMatch(/paciente.*consultas.*Tente novamente/);
    expect(await consultationRepository.countByPatient(source.patientId)).toBe(5);

    await waitSettled(sourceId);
    const requote = await postRequote(sourceId, { treatmentAmountCents: 600_000 });
    expect(requote.status).toBe(429);
    expect((await readProblem(requote)).code).toBe("PATIENT_LIMIT");
    expect(await consultationRepository.countByPatient(source.patientId)).toBe(5);

    // The cap is per patient: someone else is still accepted.
    expect((await postConsultation(signupBody())).status).toBe(202);
  });

  it("answers a same-key double submit at cap minus one as a replay", async () => {
    const cpf = uniqueCpf();
    const firstId = await createConsultation({ cpf });
    for (let created = 1; created < 4; created += 1) await createConsultation({ cpf });
    const first = await consultationRepository.findById(firstId);
    if (!first) throw new Error("first consultation not stored");
    expect(await consultationRepository.countByPatient(first.patientId)).toBe(4);

    // Several identical submits at once, so they all pass the early replay check together.
    const body = signupBody({ cpf });
    const key = randomUUID();
    const ip = uniqueIp();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postConsultation(body, { key, ip })),
    );
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202, 202]);
    const ids = await Promise.all(responses.map(readCreatedId));
    expect(new Set(ids).size).toBe(1);
    expect(await consultationRepository.countByPatient(first.patientId)).toBe(5);

    const rows = await waitFor(
      () => throttleRepository.listByIpHmac(hashIp(ip)),
      (found) => found.length === 5 && found.every((row) => row.statusCode !== null),
    );
    expect(rows.filter((row) => row.errorCode === "PATIENT_LIMIT")).toEqual([]);
  });
});
