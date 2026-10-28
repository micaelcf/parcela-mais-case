import type { BrowserContext, Route } from "@playwright/test";

import { type AddressLookup, isCep, normalizeCep } from "#/lib/address/address";

/**
 * A deterministic stand-in for `GET /api/addresses/:cep` (ViaCEP behind it), answering exactly as
 * the API does (`api.md` § Public), so no browser test depends on ViaCEP being up.
 */

/** A street address: Av. Paulista, São Paulo. */
export const PAULISTA = {
  cep: "01310100",
  street: "Avenida Paulista",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
} as const satisfies AddressLookup;

/** A city-wide style answer: no street, no neighbourhood. */
export const CITY_WIDE = {
  cep: "70040010",
  street: "",
  neighborhood: "",
  city: "Brasília",
  state: "DF",
} as const satisfies AddressLookup;

/** Answered 404 `CEP_NOT_FOUND`. */
export const UNKNOWN_CEP = "99999999";
/** Answered 503 `ADDRESS_LOOKUP_UNAVAILABLE`. */
export const UNAVAILABLE_CEP = "88888888";

/** `01310100` → `01310-100`. */
export function formatCep(digits: string): string {
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const FOUND: Record<string, AddressLookup> = {
  [PAULISTA.cep]: PAULISTA,
  [CITY_WIDE.cep]: CITY_WIDE,
};

const PROBLEM = {
  VALIDATION: {
    type: "urn:parcela:error:validation",
    title: "Dados inválidos",
    status: 422,
    code: "VALIDATION",
    detail: "Verifique os campos destacados.",
    fields: [{ path: "cep", message: "CEP inválido" }],
  },
  CEP_NOT_FOUND: {
    type: "urn:parcela:error:cep_not_found",
    title: "CEP não encontrado",
    status: 404,
    code: "CEP_NOT_FOUND",
    detail: "CEP não encontrado.",
  },
  ADDRESS_LOOKUP_UNAVAILABLE: {
    type: "urn:parcela:error:address_lookup_unavailable",
    title: "Consulta de CEP indisponível",
    status: 503,
    code: "ADDRESS_LOOKUP_UNAVAILABLE",
    detail: "Não foi possível consultar o CEP agora. Preencha o endereço.",
  },
} as const;

/** Every CEP the browser looks up, in order (digits), for tests that check what was called. */
export type LookupLog = string[];

async function answer(route: Route, log: LookupLog) {
  const raw = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
  const cep = normalizeCep(raw);
  log.push(cep);
  const found = isCep(raw) ? FOUND[cep] : undefined;
  if (found) {
    await route.fulfill({ json: found });
    return;
  }
  let problem: (typeof PROBLEM)[keyof typeof PROBLEM] = PROBLEM.CEP_NOT_FOUND;
  if (!isCep(raw)) problem = PROBLEM.VALIDATION;
  else if (cep === UNAVAILABLE_CEP) problem = PROBLEM.ADDRESS_LOOKUP_UNAVAILABLE;
  await route.fulfill({
    status: problem.status,
    contentType: "application/problem+json",
    body: JSON.stringify(problem),
  });
}

/** Routes every page of `context` to the fake; resolves to the log of looked-up CEPs. */
export async function fakeAddressLookup(context: BrowserContext): Promise<LookupLog> {
  const log: LookupLog = [];
  await context.route("**/api/addresses/*", (route) => answer(route, log));
  return log;
}
