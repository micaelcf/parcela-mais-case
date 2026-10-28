import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { LENDER_CODES } from "#/lib/enums";
import { boss } from "#/server/infra/queue/boss";
import { FINALIZE_QUEUE, lenderQueue } from "#/server/infra/queue/queues";
import { consultationRepository } from "#/server/modules/consultation/consultation.repository";
import { lenderAttemptRepository } from "#/server/modules/lender/lender-attempt.repository";

import { closeTestApp } from "../setup/app-fetch";
import {
  birthdateTurning,
  birthdateTurningTomorrow,
  formatCpf,
  postConsultation,
  readCreatedId,
  readProblem,
  readView,
  signupBody,
  uniqueCpf,
} from "./consultation-client";

// No worker runs in this file: every attempt stays PENDING and every job stays queued.

afterAll(closeTestApp);

describe("POST /consultations", () => {
  it("rejects an invalid CPF at the cpf path", async () => {
    const key = randomUUID();

    const response = await postConsultation(signupBody({ cpf: "529.982.247-24" }), { key });

    expect(response.status).toBe(422);
    const body = await readProblem(response);
    expect(body.code).toBe("VALIDATION");
    expect(body.fields?.[0]?.path).toBe("cpf");
    // Replaying the same key with a valid body creates it: nothing was stored for the key.
    const created = await postConsultation(signupBody(), { key });
    expect(created.status).toBe(202);
  });

  it("accepts only a Brazilian mobile number at the phone path", async () => {
    for (const [phone, message] of [
      ["(11) 3456-7890", "Informe um celular; telefone fixo não é aceito"],
      ["(20) 98765-4321", "DDD inválido"],
      ["(11) 88765-4321", "O celular deve ter 9 dígitos começando com 9 depois do DDD"],
      ["+1 415 555 0100", "Informe o celular com DDD, ex.: (11) 98765-4321"],
    ] as const) {
      const response = await postConsultation(signupBody({ phone }));
      expect([phone, response.status]).toEqual([phone, 422]);
      expect((await readProblem(response)).fields).toEqual([{ path: "phone", message }]);
    }
    expect((await postConsultation(signupBody({ phone: "+55 21 97654-3210" }))).status).toBe(202);
  });

  it("enforces the 18–80 age bounds", async () => {
    const seventeen = await postConsultation(
      signupBody({ birthdate: birthdateTurningTomorrow(18) }),
    );
    const eightyOne = await postConsultation(signupBody({ birthdate: birthdateTurning(81) }));
    for (const response of [seventeen, eightyOne]) {
      expect(response.status).toBe(422);
      const body = await readProblem(response);
      expect(body.code).toBe("VALIDATION");
      expect(body.fields?.[0]?.path).toBe("birthdate");
    }

    const eighteen = await postConsultation(signupBody({ birthdate: birthdateTurning(18) }));
    const eighty = await postConsultation(signupBody({ birthdate: birthdateTurningTomorrow(81) }));
    expect(eighteen.status).toBe(202);
    expect(eighty.status).toBe(202);
  });

  it("enforces the amount bounds", async () => {
    for (const treatmentAmountCents of [99_999, 5_000_001]) {
      const response = await postConsultation(signupBody({ treatmentAmountCents }));
      expect(response.status).toBe(422);
      const body = await readProblem(response);
      expect(body.code).toBe("VALIDATION");
      expect(body.fields?.[0]?.path).toBe("treatmentAmountCents");
    }
    for (const treatmentAmountCents of [100_000, 5_000_000]) {
      const response = await postConsultation(signupBody({ treatmentAmountCents }));
      expect(response.status).toBe(202);
    }
  });

  it("returns the id before any lender answers", async () => {
    const id = await readCreatedId(await postConsultation(signupBody()));

    const attempts = await lenderAttemptRepository.listByConsultation(id);
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("creates exactly one attempt per lender", async () => {
    const id = await readCreatedId(await postConsultation(signupBody()));

    const attempts = await lenderAttemptRepository.listByConsultation(id);
    expect(attempts.map((attempt) => attempt.lender).sort()).toEqual([...LENDER_CODES].sort());
  });

  it("replays an identical submission", async () => {
    const key = randomUUID();
    const body = signupBody();

    const first = await readCreatedId(await postConsultation(body, { key }));
    const second = await readCreatedId(await postConsultation(body, { key }));

    expect(second).toBe(first);
    expect(await consultationRepository.findByIdempotencyKey(key)).toMatchObject({
      id: first,
    });
    const attempts = await lenderAttemptRepository.listByConsultation(first);
    expect(attempts).toHaveLength(4);
    for (const attempt of attempts) {
      const jobs = await boss.findJobs(lenderQueue(attempt.lender), {
        data: { attemptId: attempt.id },
      });
      expect(jobs).toHaveLength(1);
    }
    const finalizeJobs = await boss.findJobs(FINALIZE_QUEUE, { data: { consultationId: first } });
    expect(finalizeJobs).toHaveLength(1);
  });

  it("treats the Idempotency-Key as one UUID whatever its letter case", async () => {
    // Swift's UUID().uuidString is upper case; the same UUID in either case is one key.
    const key = randomUUID();
    const body = signupBody();

    const upper = await postConsultation(body, { key: key.toUpperCase() });
    expect(upper.status).toBe(202);
    const first = await readCreatedId(upper);
    const second = await readCreatedId(await postConsultation(body, { key }));

    expect(second).toBe(first);
  });

  it("rejects a reused key with a different body", async () => {
    const key = randomUUID();
    const original = signupBody({ treatmentAmountCents: 1_000_000 });
    const id = await readCreatedId(await postConsultation(original, { key }));
    const before = await readView(id);

    const reused = await postConsultation({ ...original, treatmentAmountCents: 900_000 }, { key });

    expect(reused.status).toBe(422);
    expect((await readProblem(reused)).code).toBe("IDEMPOTENCY_KEY_REUSED");
    const after = await readView(id);
    expect(after.treatmentAmountCents).toBe(1_000_000);
    expect(after).toEqual(before);
  });

  it("reuses the patient for a known CPF", async () => {
    const cpf = uniqueCpf();

    const first = await readCreatedId(
      await postConsultation(
        signupBody({
          cpf: formatCpf(cpf),
          monthlyIncomeCents: 500_000,
          treatmentAmountCents: 800_000,
        }),
      ),
    );
    const second = await readCreatedId(
      await postConsultation(
        signupBody({ cpf, monthlyIncomeCents: 700_000, treatmentAmountCents: 1_200_000 }),
      ),
    );

    const [a, b] = await Promise.all([
      consultationRepository.findById(first),
      consultationRepository.findById(second),
    ]);
    expect(a?.patientId).toBeDefined();
    expect(b?.patientId).toBe(a?.patientId);
    expect(a).toMatchObject({ monthlyIncomeCents: 500_000, treatmentAmountCents: 800_000 });
    expect(b).toMatchObject({ monthlyIncomeCents: 700_000, treatmentAmountCents: 1_200_000 });
  });
});
