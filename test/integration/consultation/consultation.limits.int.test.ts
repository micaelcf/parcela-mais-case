import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

// Must be set before any app module reads the env (dynamic imports below).
process.env.RATE_LIMIT_PATIENT_MAX = "5";
process.env.RATE_LIMIT_PATIENT_WINDOW_HOURS = "24";

const { consultationRepository } =
  await import("#/server/modules/consultation/consultation.repository");
const { createWorker } = await import("#/server/worker");
const { closeTestApp, testLenderRegistry } = await import("../setup/app-fetch");
const {
  createConsultation,
  postConsultation,
  postRequote,
  readProblem,
  signupBody,
  uniqueCpf,
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
});
