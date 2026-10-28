import { type AddressLookup, normalizeCep } from "#/lib/address/address";

import { api, toProblem } from "./eden";

/**
 * What a CEP lookup tells the form: the address, no such CEP, a CEP the API rejects, or no answer
 * now (ViaCEP down, the per-IP cap, the network): then the patient types the address in.
 */
export type AddressLookupResult =
  | { kind: "found"; address: AddressLookup }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

const KIND_BY_CODE: Partial<Record<string, "not_found" | "invalid">> = {
  CEP_NOT_FOUND: "not_found",
  VALIDATION: "invalid",
};

/** `GET /api/addresses/:cep`; never throws (an aborted call reads as unavailable). */
export async function lookupAddress(
  cep: string,
  signal?: AbortSignal,
): Promise<AddressLookupResult> {
  try {
    const { data, error } = await api
      .addresses({ cep: normalizeCep(cep) })
      .get({ fetch: { signal } });
    if (!error) return { kind: "found", address: data };
    return { kind: KIND_BY_CODE[toProblem(error).code] ?? "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
