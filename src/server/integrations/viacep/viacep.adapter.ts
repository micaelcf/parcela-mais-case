import Type from "typebox";
import { Compile } from "typebox/compile";

import { type AddressLookup, BR_STATES, normalizeCep } from "#/lib/address/address";
import { env } from "#/server/infra/env/server-env";
import type { FetchLike } from "#/server/integrations/lenders/lender.port";

/** ViaCEP's answer for a known CEP (it sends more keys; only these are read). */
const ViaCepAddress = Compile(
  Type.Object({
    cep: Type.String({ pattern: "^\\d{5}-?\\d{3}$" }),
    logradouro: Type.String(),
    bairro: Type.String(),
    localidade: Type.String({ minLength: 1 }),
    uf: Type.Enum(BR_STATES),
  }),
);

/** ViaCEP's 200 for a well-formed CEP it doesn't know (both spellings exist in the wild). */
const ViaCepUnknown = Compile(
  Type.Object({ erro: Type.Union([Type.Literal(true), Type.Literal("true")]) }),
);

export type ViaCepUnavailableReason = "http_status" | "network" | "timeout" | "invalid_body";

export type ViaCepResult =
  | { outcome: "found"; address: AddressLookup }
  | { outcome: "not_found" }
  | { outcome: "unavailable"; reason: ViaCepUnavailableReason };

export type ViaCepDeps = { baseUrl: string; timeoutMs: number; fetch: FetchLike };

export type ViaCepClient = { lookup(cep: string): Promise<ViaCepResult> };

const NOT_FOUND: ViaCepResult = { outcome: "not_found" };

const unavailable = (reason: ViaCepUnavailableReason): ViaCepResult => ({
  outcome: "unavailable",
  reason,
});

/**
 * `GET {baseUrl}/ws/{8 digits}/json/`, bounded by `timeoutMs` (headers and body). `not_found`:
 * a 200 with `erro`, or HTTP 400; `unavailable`: any other status, a network failure, the
 * timeout, or a body that isn't the expected JSON. Never throws.
 */
export function createViaCepClient(deps: ViaCepDeps): ViaCepClient {
  const baseUrl = deps.baseUrl.replace(/\/+$/, "");
  return {
    async lookup(cep) {
      const signal = AbortSignal.timeout(deps.timeoutMs);
      const failure = (fallback: ViaCepUnavailableReason) =>
        unavailable(signal.aborted ? "timeout" : fallback);

      let response: Response;
      try {
        response = await deps.fetch(`${baseUrl}/ws/${normalizeCep(cep)}/json/`, {
          headers: { accept: "application/json" },
          signal,
        });
      } catch {
        return failure("network");
      }
      if (!response.ok) {
        response.body?.cancel().catch(() => undefined);
        return response.status === 400 ? NOT_FOUND : unavailable("http_status");
      }

      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch {
        return failure("invalid_body");
      }
      if (ViaCepUnknown.Check(body)) return NOT_FOUND;
      if (!ViaCepAddress.Check(body)) return unavailable("invalid_body");
      return {
        outcome: "found",
        address: {
          cep: normalizeCep(body.cep),
          street: body.logradouro.trim(),
          neighborhood: body.bairro.trim(),
          city: body.localidade.trim(),
          state: body.uf,
        },
      };
    },
  };
}

export const viaCepClient: ViaCepClient = createViaCepClient({
  baseUrl: env.VIACEP_BASE_URL,
  timeoutMs: env.VIACEP_TIMEOUT_MS,
  fetch: (input, init) => globalThis.fetch(input, init),
});
