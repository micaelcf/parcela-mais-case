import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";

import { normalizeCpf } from "#/lib/cpf/cpf";
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
  type SignupRequest,
  toConsultationPublicView,
  toIsoDate,
} from "./consultation.dto";
import { consultationRepository } from "./consultation.repository";

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

async function createOnce(
  body: SignupRequest,
  idempotencyKey: string,
  requestHash: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const existing = await consultationRepository.findByIdempotencyKey(idempotencyKey, tx);
    if (existing) {
      if (existing.requestHash === requestHash) return existing.id;
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSED",
        "Esta chave de idempotência já foi usada com outros dados.",
      );
    }

    const scenario = body.simulationScenario ?? "NORMAL";
    if (scenario !== "NORMAL" && !env.SIMULATION_CONTROLS) {
      throw new DomainError("SIMULATION_DISABLED", "Cenários de simulação estão desativados.");
    }

    const patientId = await patientService.upsertAndLock(tx, body);
    const ageYears = ageOn(body.birthdate, toIsoDate(new Date()));
    if (ageYears === null) throw new Error("birthdate passed validation but is not a date");

    const created = await consultationRepository.insert(tx, {
      patientId,
      idempotencyKey,
      requestHash,
      monthlyIncomeCents: body.monthlyIncomeCents,
      treatmentAmountCents: body.treatmentAmountCents,
      birthdate: body.birthdate,
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

export const consultationService = {
  /**
   * `boundaries.md` § Create: one TX that replays or rejects a known idempotency key, gates the
   * scenario, upserts and locks the patient, inserts the consultation with four PENDING attempts
   * and enqueues their lender jobs plus the finalizer (transactional outbox).
   */
  async create(body: SignupRequest, idempotencyKey: string): Promise<{ id: string }> {
    const requestHash = requestHashOf(body);
    await startBoss();
    try {
      return { id: await createOnce(body, idempotencyKey, requestHash) };
    } catch (error) {
      // Lost the race for the key: the winner has committed, so this is now a replay.
      if (error instanceof IdempotencyRace) {
        return { id: await createOnce(body, idempotencyKey, requestHash) };
      }
      throw error;
    }
  },

  /** The public view; finalizes first when the deadline has passed (lazy finalize). */
  async view(id: string): Promise<ConsultationPublicView> {
    if (!isUuid(id)) throw notFound();
    const rows = await consultationRepository.findViewRows(db, id);
    if (!rows) throw notFound();
    if (rows.consultation.quoteStatus === "QUOTING" && rows.pastDeadline) {
      await consultationService.finalize(id);
      const settled = await consultationRepository.findViewRows(db, id);
      if (!settled) throw notFound();
      return toConsultationPublicView(settled);
    }
    return toConsultationPublicView(rows);
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
