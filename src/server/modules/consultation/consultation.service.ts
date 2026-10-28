import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";

import { normalizeCpf } from "#/lib/cpf/cpf";
import type { SimulationScenario } from "#/lib/enums";
import { db, type Tx } from "#/server/infra/db/client";
import { env } from "#/server/infra/env/server-env";
import { boss, startBoss } from "#/server/infra/queue/boss";
import { FINALIZE_QUEUE, lenderQueue } from "#/server/infra/queue/queues";
import { notifyConsultationUpdated } from "#/server/infra/realtime/consultation-events";
import { DomainError } from "#/server/lib/errors/domain-error";
import { lenderAttemptService } from "#/server/modules/lender/lender-attempt.service";
import { patientService } from "#/server/modules/patient/patient.service";
import { pricingService } from "#/server/modules/pricing/pricing.service";

import {
  ageOn,
  type ConsultationPublicView,
  isUuid,
  normalizePhone,
  type RequoteRequest,
  type SignupRequest,
  toConsultationPublicView,
  toIsoDate,
} from "./consultation.dto";
import { type ConsultationReadRows, consultationRepository } from "./consultation.repository";

const notFound = () => new DomainError("CONSULTATION_NOT_FOUND", "Consulta não encontrada.");

/** Thrown inside the create TX when a concurrent request took the idempotency key first. */
class IdempotencyRace extends Error {}

/** sha256 of the canonical request: the normalised fields in a fixed order. */
function requestHashOf(body: SignupRequest): string {
  const canonical = JSON.stringify([
    body.fullName.trim(),
    normalizeCpf(body.cpf),
    body.birthdate,
    normalizePhone(body.phone),
    body.monthlyIncomeCents,
    body.treatmentAmountCents,
    body.simulationScenario ?? "NORMAL",
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** sha256 of the canonical requote: the source id plus the normalised body. */
function requoteHashOf(sourceId: string, body: RequoteRequest): string {
  const canonical = JSON.stringify([
    "requote",
    sourceId,
    body.treatmentAmountCents,
    body.simulationScenario ?? "NORMAL",
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Everything the single create path needs; create and requote only differ in how they build it. */
type CreateCommand = {
  idempotencyKey: string;
  requestHash: string;
  scenario: SimulationScenario;
  monthlyIncomeCents: number;
  treatmentAmountCents: number;
  birthdate: string;
  /** Resolves the patient and locks its row until the TX ends; returns its id. */
  lockPatient(tx: Tx): Promise<string>;
};

/** RF-504: the patient's consultations in the window, counted under the patient lock. */
async function assertBelowPatientCap(tx: Tx, patientId: string): Promise<void> {
  const recent = await consultationRepository.countByPatient(patientId, {
    withinHours: env.RATE_LIMIT_PATIENT_WINDOW_HOURS,
    executor: tx,
  });
  if (recent >= env.RATE_LIMIT_PATIENT_MAX) {
    throw new DomainError(
      "PATIENT_LIMIT",
      `Este paciente já fez ${env.RATE_LIMIT_PATIENT_MAX} consultas nas últimas ${env.RATE_LIMIT_PATIENT_WINDOW_HOURS} horas. Tente novamente mais tarde.`,
    );
  }
}

/** The id of an earlier create with this key and body; reused key with another body → 422. */
async function replayOf(tx: Tx, command: CreateCommand): Promise<string | undefined> {
  const existing = await consultationRepository.findByIdempotencyKey(command.idempotencyKey, tx);
  if (!existing) return undefined;
  if (existing.requestHash === command.requestHash) return existing.id;
  throw new DomainError(
    "IDEMPOTENCY_KEY_REUSED",
    "Esta chave de idempotência já foi usada com outros dados.",
  );
}

async function createOnce(command: CreateCommand): Promise<string> {
  return db.transaction(async (tx) => {
    const replayed = await replayOf(tx, command);
    if (replayed) return replayed;

    const scenario = command.scenario;
    if (scenario !== "NORMAL" && !env.SIMULATION_CONTROLS) {
      throw new DomainError("SIMULATION_DISABLED", "Cenários de simulação estão desativados.");
    }

    const patientId = await command.lockPatient(tx);
    // A same-key twin may have committed while we waited for the lock: a replay, never a cap hit.
    const replayedUnderLock = await replayOf(tx, command);
    if (replayedUnderLock) return replayedUnderLock;
    await assertBelowPatientCap(tx, patientId);
    const ageYears = ageOn(command.birthdate, toIsoDate(new Date()));
    if (ageYears === null) throw new Error("birthdate passed validation but is not a date");

    const created = await consultationRepository.insert(tx, {
      patientId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      monthlyIncomeCents: command.monthlyIncomeCents,
      treatmentAmountCents: command.treatmentAmountCents,
      birthdate: command.birthdate,
      ageYears,
      simulationScenario: scenario,
      deadlineMs: env.CONSULTATION_DEADLINE_MS,
    });
    if (!created) throw new IdempotencyRace();

    const attempts = await lenderAttemptService.createPending(tx, created.id, scenario);
    const outbox = { db: fromDrizzle(tx, sql) };
    for (const attempt of attempts) {
      await boss.send(lenderQueue(attempt.lender), { attemptId: attempt.id }, outbox);
    }
    await boss.send(
      FINALIZE_QUEUE,
      { consultationId: created.id },
      { ...outbox, startAfter: created.deadlineAt },
    );
    return created.id;
  });
}

/** `boundaries.md` § Create: the one path both create and requote run through. */
async function createConsultation(command: CreateCommand): Promise<{ id: string }> {
  await startBoss();
  try {
    return { id: await createOnce(command) };
  } catch (error) {
    // Lost the race for the key: the winner has committed, so this is now a replay.
    if (error instanceof IdempotencyRace) return { id: await createOnce(command) };
    throw error;
  }
}

/** The view rows, finalized first when the deadline has passed (lazy finalize). */
async function currentViewRows(id: string): Promise<ConsultationReadRows> {
  if (!isUuid(id)) throw notFound();
  const rows = await consultationRepository.findViewRows(db, id);
  if (!rows) throw notFound();
  if (rows.consultation.quoteStatus === "QUOTING" && rows.pastDeadline) {
    await consultationService.finalize(id);
    const settled = await consultationRepository.findViewRows(db, id);
    if (!settled) throw notFound();
    return settled;
  }
  return rows;
}

const requoteNotAllowed = (detail: string) => new DomainError("REQUOTE_NOT_ALLOWED", detail);

export const consultationService = {
  /**
   * `boundaries.md` § Create: one TX that replays or rejects a known idempotency key, gates the
   * scenario, upserts and locks the patient, enforces the per-patient cap, inserts the
   * consultation with four PENDING attempts and enqueues their lender jobs plus the finalizer
   * (transactional outbox).
   */
  create(body: SignupRequest, idempotencyKey: string): Promise<{ id: string }> {
    return createConsultation({
      idempotencyKey,
      requestHash: requestHashOf(body),
      scenario: body.simulationScenario ?? "NORMAL",
      monthlyIncomeCents: body.monthlyIncomeCents,
      treatmentAmountCents: body.treatmentAmountCents,
      birthdate: body.birthdate,
      lockPatient: (tx) => patientService.upsertAndLock(tx, body),
    });
  },

  /**
   * `boundaries.md` § Requote: the source must be settled, without any approval, and the new
   * amount lower; then the create path runs for the source's patient with its frozen income and
   * birthdate (age recomputed today), in NORMAL unless a scenario is sent.
   */
  async requote(
    sourceId: string,
    body: RequoteRequest,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    const source = await currentViewRows(sourceId);
    const { consultation } = source;
    if (consultation.quoteStatus !== "SETTLED") {
      throw requoteNotAllowed("A consulta original ainda está em andamento.");
    }
    if (source.attempts.some((attempt) => attempt.status === "APPROVED")) {
      throw requoteNotAllowed("A consulta original já tem uma pré-aprovação.");
    }
    if (body.treatmentAmountCents >= consultation.treatmentAmountCents) {
      throw requoteNotAllowed("O novo valor deve ser menor que o da consulta original.");
    }
    return createConsultation({
      idempotencyKey,
      requestHash: requoteHashOf(sourceId, body),
      scenario: body.simulationScenario ?? "NORMAL",
      monthlyIncomeCents: consultation.monthlyIncomeCents,
      treatmentAmountCents: body.treatmentAmountCents,
      birthdate: consultation.birthdate,
      lockPatient: async (tx) => {
        await consultationRepository.lockPatient(tx, consultation.patientId);
        return consultation.patientId;
      },
    });
  },

  /** The public view; finalizes first when the deadline has passed (lazy finalize). */
  async view(id: string): Promise<ConsultationPublicView> {
    return toConsultationPublicView(await currentViewRows(id));
  },

  /**
   * Idempotent (`boundaries.md` § Finalize): every PENDING attempt → UNAVAILABLE/TIMEOUT, then
   * the consultation → SETTLED, then NOTIFY if anything changed. Used by the finalize job and by
   * reads past the deadline.
   */
  async finalize(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const timedOut = await lenderAttemptService.timeoutPending(tx, id);
      const settled = await consultationService.settleIfComplete(tx, id);
      if (timedOut > 0 || settled) await notifyConsultationUpdated(tx, id);
    });
  },

  /**
   * Settles the consultation once no attempt is PENDING. Locks the consultation row first, so of
   * two attempts settling concurrently the later one sees the earlier one's commit.
   */
  async settleIfComplete(tx: Tx, id: string): Promise<boolean> {
    const locked = await consultationRepository.lockById(tx, id);
    if (!locked || locked.quoteStatus !== "QUOTING") return false;
    if ((await lenderAttemptService.countPending(tx, id)) > 0) return false;
    return consultationRepository.markSettled(tx, id);
  },

  /**
   * `boundaries.md` § Choose: under the consultation lock, the offer must belong to it; the first
   * choice sticks, re-choosing it is a no-op, any other offer conflicts. Allowed while QUOTING.
   */
  async choose(id: string, offerId: string): Promise<ConsultationPublicView> {
    if (!isUuid(id)) throw notFound();
    await db.transaction(async (tx) => {
      const locked = await consultationRepository.lockById(tx, id);
      if (!locked) throw notFound();
      const offer = await pricingService.findOffer(tx, offerId, id);
      if (!offer) throw new DomainError("OFFER_NOT_FOUND", "Oferta não encontrada.");
      if (locked.chosenOfferId === offerId) return;
      if (locked.chosenOfferId !== null) {
        throw new DomainError("CHOICE_CONFLICT", "Outra oferta já foi escolhida.");
      }
      await consultationRepository.setChoice(tx, id, offerId);
      await notifyConsultationUpdated(tx, id);
    });
    return consultationService.view(id);
  },
};
