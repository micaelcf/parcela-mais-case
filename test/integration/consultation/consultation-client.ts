import { randomInt, randomUUID } from "node:crypto";

import { cpfCheckDigits } from "#/lib/cpf/cpf";
import type { SimulationScenario } from "#/lib/enums";
import { Compile } from "typebox/compile";

import {
  type ConsultationPublicView,
  ConsultationPublicViewSchema,
  CreatedSchema,
  type SignupRequest,
} from "#/server/modules/consultation/consultation.dto";
import type { ProblemBody } from "#/server/infra/http/errors.plugin";

import { appFetch } from "../setup/app-fetch";

/**
 * Drives the public consultation API through the real app (`app.handle`), with unique inputs per
 * call: a fresh CPF (`cpfCheckDigits`), a fresh Idempotency-Key and a fresh X-Forwarded-For.
 */

const API = "http://localhost/api";

const View = Compile(ConsultationPublicViewSchema);
const Created = Compile(CreatedSchema);

/** The body of a problem+json response (shape asserted). */
export async function readProblem(response: Response): Promise<ProblemBody> {
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("code" in body) || typeof body.code !== "string") {
    throw new Error(`not a problem body: ${JSON.stringify(body)}`);
  }
  // Shape checked above on the discriminating field; the rest is the errors plugin's contract.
  const problem = body as ProblemBody;
  return problem;
}

/** The id of a 202 create response (throws on any other answer). */
export async function readCreatedId(response: Response): Promise<string> {
  const text = await response.text();
  if (response.status !== 202) throw new Error(`create answered ${response.status}: ${text}`);
  return Created.Parse(JSON.parse(text)).id;
}

/** A valid, unformatted CPF never handed out before in this process. */
export function uniqueCpf(): string {
  for (;;) {
    const base = String(randomInt(0, 1_000_000_000)).padStart(9, "0");
    if (/^(\d)\1{8}$/.test(base)) continue;
    return `${base}${cpfCheckDigits(base)}`;
  }
}

export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

let ipCounter = 0;
/** A distinct client IP per call (10.0.0.0/8), so per-IP limits never couple two tests. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The birthdate of someone turning `age` today (the youngest person aged `age`). */
export function birthdateTurning(age: number, today: Date = new Date()): string {
  const date = new Date(today.getFullYear() - age, today.getMonth(), today.getDate());
  // 29 Feb in a non-leap year rolls to 1 Mar; step back to 28 Feb so the age holds.
  if (date.getMonth() !== today.getMonth()) date.setDate(0);
  return localIsoDate(date);
}

/** The day after `birthdateTurning(age)`: whoever was born then is still `age − 1` today. */
export function birthdateTurningTomorrow(age: number, today: Date = new Date()): string {
  const date = new Date(today.getFullYear() - age, today.getMonth(), today.getDate() + 1);
  return localIsoDate(date);
}

export function signupBody(overrides: Partial<SignupRequest> = {}): SignupRequest {
  return {
    fullName: "Maria da Silva",
    cpf: uniqueCpf(),
    birthdate: birthdateTurning(40),
    phone: "11987654321",
    monthlyIncomeCents: 1_000_000,
    treatmentAmountCents: 1_000_000,
    ...overrides,
  };
}

export function postConsultation(
  body: unknown,
  options: { key?: string; ip?: string } = {},
): Promise<Response> {
  return appFetch(`${API}/consultations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.key ?? randomUUID(),
      "x-forwarded-for": options.ip ?? uniqueIp(),
    },
    body: JSON.stringify(body),
  });
}

/** POSTs a consultation and returns its id (throws unless 202). */
export async function createConsultation(
  overrides: Partial<SignupRequest> = {},
  scenario?: SimulationScenario,
): Promise<string> {
  const response = await postConsultation(
    signupBody({ ...overrides, ...(scenario ? { simulationScenario: scenario } : {}) }),
  );
  return readCreatedId(response);
}

export function getConsultation(id: string): Promise<Response> {
  return appFetch(`${API}/consultations/${id}`);
}

export async function readView(id: string): Promise<ConsultationPublicView> {
  const response = await getConsultation(id);
  if (response.status !== 200) {
    throw new Error(`GET answered ${response.status}: ${await response.text()}`);
  }
  return View.Parse(await response.json());
}

export function choose(id: string, offerId: string): Promise<Response> {
  return appFetch(`${API}/consultations/${id}/choice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offerId }),
  });
}

/** POSTs a requote of `sourceId` (fresh Idempotency-Key and X-Forwarded-For unless given). */
export function postRequote(
  sourceId: string,
  body: unknown,
  options: { key?: string; ip?: string } = {},
): Promise<Response> {
  return appFetch(`${API}/consultations/${sourceId}/requote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": options.key ?? randomUUID(),
      "x-forwarded-for": options.ip ?? uniqueIp(),
    },
    body: JSON.stringify(body),
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `read` until `done` holds (every `intervalMs`), failing after `timeoutMs`. */
export async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 10_000, intervalMs = 50 } = options;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`condition not met in ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}

/**
 * Waits for the consultation to settle (polls GET every 250 ms: tests often wait on many
 * consultations at once, and tighter polling would compete with the worker for connections).
 */
export function waitSettled(id: string, timeoutMs = 10_000): Promise<ConsultationPublicView> {
  return waitFor(
    () => readView(id),
    (view) => view.quoteStatus === "SETTLED",
    { timeoutMs, intervalMs: 250 },
  );
}

/** A parsed SSE event. */
export type StreamEvent = { event: string; data: unknown };

/** Opens the consultation's SSE stream (the raw response). */
export function openEvents(id: string, signal?: AbortSignal): Promise<Response> {
  return appFetch(`${API}/consultations/${id}/events`, { signal });
}

/** Opens `/events` and collects every event until the server closes the stream or `signal` aborts. */
export async function readEvents(
  id: string,
  options: { signal?: AbortSignal; onEvent?: (event: StreamEvent) => void } = {},
): Promise<{ status: number; events: StreamEvent[]; body: string }> {
  const response = await openEvents(id, options.signal);
  if (response.status !== 200 || !response.body) {
    return { status: response.status, events: [], body: await response.text() };
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events: StreamEvent[] = [];
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        const event: StreamEvent = { event: "message", data: null };
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event.event = line.slice(7);
          else if (line.startsWith("data: ")) event.data = JSON.parse(line.slice(6));
        }
        events.push(event);
        options.onEvent?.(event);
      }
    }
  } catch (error) {
    if (!options.signal?.aborted) throw error;
  }
  return { status: response.status, events, body: "" };
}
