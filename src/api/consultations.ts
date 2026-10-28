import type {
  ConsultationPublicView,
  Created,
  RequoteRequest,
  SignupRequest,
} from "#/server/modules/consultation/consultation.dto";

import { api, type Result, toProblem, toResult } from "./eden";

/** Public UI flags (`GET /api/config`). */
export async function getConfig(): Promise<{ simulationControls: boolean }> {
  const { data, error } = await api.config.get();
  if (error) throw new Error(toProblem(error).title);
  return data;
}

/** The consultation view, or null when it doesn't exist. */
export async function getConsultation(id: string): Promise<ConsultationPublicView | null> {
  const { data, error } = await api.consultations({ id }).get();
  if (!error) return data;
  const problem = toProblem(error);
  if (problem.status === 404 || problem.status === 422) return null;
  throw new Error(problem.title);
}

/** Every snapshot of one live connection; ends when the server closes the stream. */
export async function* consultationSnapshots(
  id: string,
  signal: AbortSignal,
): AsyncGenerator<ConsultationPublicView> {
  const { data, error } = await api.consultations({ id }).events.get({ fetch: { signal } });
  if (error) throw new Error(toProblem(error).title);
  for await (const message of data) {
    if (message.event === "snapshot" && message.data) yield message.data;
  }
}

export function createConsultation(
  body: SignupRequest,
  idempotencyKey: string,
): Promise<Result<Created>> {
  return toResult(() =>
    api.consultations.post(body, { headers: { "idempotency-key": idempotencyKey } }),
  );
}

export function chooseOffer(id: string, offerId: string): Promise<Result<ConsultationPublicView>> {
  return toResult(() => api.consultations({ id }).choice.post({ offerId }));
}

export function requoteConsultation(
  id: string,
  body: RequoteRequest,
  idempotencyKey: string,
): Promise<Result<Created>> {
  return toResult(() =>
    api
      .consultations({ id })
      .requote.post(body, { headers: { "idempotency-key": idempotencyKey } }),
  );
}
