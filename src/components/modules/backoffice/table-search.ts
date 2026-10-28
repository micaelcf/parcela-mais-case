import Type, { type Static, type TObject, type TSchema } from "typebox";

import { LENDER_CODES, QUOTE_STATUSES, SIMULATION_SCENARIOS } from "#/lib/enums";
import { ListQuerySchema } from "#/lib/list/list-contract";
import { type StandardSchemaV1, toStandardSchema } from "#/lib/validation/standard-schema";
import { LIMIT_CODES, THROTTLE_ROUTES } from "#/server/modules/backoffice/backoffice.dto";
import { JOURNEY_STATUSES } from "#/server/modules/consultation/consultation.dto";

/**
 * The URL state of each backoffice table (RF-615, RF-617): the list contract's `page`, `pageSize`,
 * `sort` and `q`, plus the endpoint's allow-listed filters as top-level params. The CPF is never a
 * table param: a `cpf` key can't be declared and is dropped from any URL that carries one.
 */

/** Keys no table URL keeps, whatever a link or a hand-typed address says. */
const FORBIDDEN_KEYS: Record<string, true> = { cpf: true };

export type SortValue<Field extends string> = `${Field}:asc` | `${Field}:desc`;

/** A table's search schema: list-contract basics, the endpoint's sorts and its optional filters. */
export function listSearchSchema<
  const Field extends string,
  Filters extends Record<string, TSchema> & { cpf?: never },
>(spec: { sorts: readonly Field[]; filters: Filters }) {
  const sortValues = spec.sorts.flatMap((field): SortValue<Field>[] => [
    `${field}:asc`,
    `${field}:desc`,
  ]);
  return Type.Object({
    page: ListQuerySchema.properties.page,
    pageSize: ListQuerySchema.properties.pageSize,
    sort: Type.Optional(Type.Enum(sortValues)),
    q: ListQuerySchema.properties.q,
    ...spec.filters,
  });
}

/**
 * `validateSearch` for a table route, through the Standard Schema adapter: keeps only the schema's
 * own keys (never `cpf`), coerces URL values, and drops a value that doesn't fit (a stale or
 * hand-edited URL) instead of failing the page.
 */
export function listSearchValidator<T extends TObject>(
  schema: T,
): StandardSchemaV1<Static<T>, Static<T>> {
  const keys = Object.keys(schema.properties).filter((key) => !Object.hasOwn(FORBIDDEN_KEYS, key));
  const standard = toStandardSchema(schema, { coerce: true })["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate(input) {
        let candidate = pickKnown(input, keys);
        for (;;) {
          const result = standard.validate(candidate);
          if (!result.issues) return result;
          const invalid = new Set(result.issues.map((issue) => issue.path[0]));
          const kept = Object.entries(candidate).filter(([key]) => !invalid.has(key));
          if (kept.length === Object.keys(candidate).length) return { value: {} as Static<T> };
          candidate = Object.fromEntries(kept);
        }
      },
    },
  };
}

/** Next table state: `input` through the table's validator (which drops what doesn't fit). */
export function parseListSearch<T>(validator: StandardSchemaV1<T, T>, input: unknown): T {
  const result = validator["~standard"].validate(input);
  if (result.issues) throw new Error("Parâmetros de tabela inválidos.");
  return result.value;
}

function pickKnown(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (keys.includes(key) && value !== undefined && value !== "") picked[key] = value;
  }
  return picked;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day as typed in a date input (`2026-10-28`). */
const DateSchema = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

/**
 * Table URL state → the list API's query. Calendar-day range bounds become instants covering the
 * whole local day (`…From` at 00:00, `…To` at 23:59:59.999); booleans become `"true"`/`"false"`.
 */
export function toListQuery(search: Record<string, unknown>): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || Object.hasOwn(FORBIDDEN_KEYS, key)) continue;
    if (typeof value === "boolean") query[key] = String(value);
    else if (typeof value === "string" && DATE_ONLY.test(value) && key.endsWith("From")) {
      query[key] = new Date(`${value}T00:00:00`).toISOString();
    } else if (typeof value === "string" && DATE_ONLY.test(value) && key.endsWith("To")) {
      query[key] = new Date(`${value}T23:59:59.999`).toISOString();
    } else if (typeof value === "string" || typeof value === "number") query[key] = value;
  }
  return query;
}

/** `"createdAt:desc"` ↔ TanStack Table sorting state (one column, manual). */
export function sortingOf(sort: string | undefined): Array<{ id: string; desc: boolean }> {
  if (!sort) return [];
  const [id, direction] = sort.split(":");
  return id ? [{ id, desc: direction === "desc" }] : [];
}

export function sortOf(sorting: ReadonlyArray<{ id: string; desc: boolean }>): string | undefined {
  const first = sorting[0];
  return first ? `${first.id}:${first.desc ? "desc" : "asc"}` : undefined;
}

/**
 * What a table's search box may do with the typed text (RF-617): `q` is a URL param, so a CPF must
 * never become one. `cpf`: holds a CPF (formatted or not, alone or next to other words): never
 * applied. `digits`: only digits and CPF punctuation, still short of a CPF: applied on Enter only,
 * so a pause while typing a CPF never puts its first digits in the URL. `text`: applied as usual.
 */
export type SearchTextKind = "empty" | "text" | "digits" | "cpf";

/** A CPF-shaped run: 11 digits, optionally punctuated as `000.000.000-00`, not inside a longer run. */
const CPF_RUN = /(^|\D)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}(?!\d)/;
const DIGITS_AND_PUNCTUATION = /^[\d.\-\s]+$/;

export function classifySearchText(text: string): SearchTextKind {
  const trimmed = text.trim();
  if (trimmed === "") return "empty";
  if (CPF_RUN.test(trimmed)) return "cpf";
  if (!DIGITS_AND_PUNCTUATION.test(trimmed)) return "text";
  return trimmed.replace(/\D/g, "").length >= 11 ? "cpf" : "digits";
}

// ── Per-table schemas (allow-lists of `backoffice.repository.ts`) ──────────────────────────────

export const ConsultationSearchSchema = listSearchSchema({
  sorts: ["createdAt", "treatmentAmountCents", "settledAt", "status"],
  filters: {
    status: Type.Optional(Type.Enum(JOURNEY_STATUSES)),
    quoteStatus: Type.Optional(Type.Enum(QUOTE_STATUSES)),
    simulationScenario: Type.Optional(Type.Enum(SIMULATION_SCENARIOS)),
    patientId: Type.Optional(Type.String({ format: "uuid" })),
    createdAtFrom: Type.Optional(DateSchema),
    createdAtTo: Type.Optional(DateSchema),
    treatmentAmountCentsFrom: Type.Optional(Type.Integer({ minimum: 0 })),
    treatmentAmountCentsTo: Type.Optional(Type.Integer({ minimum: 0 })),
  },
});
export type ConsultationSearch = Static<typeof ConsultationSearchSchema>;

export const SwitchLogSearchSchema = listSearchSchema({
  sorts: ["createdAt", "lender"],
  filters: {
    lender: Type.Optional(Type.Enum(LENDER_CODES)),
    enabled: Type.Optional(Type.Boolean()),
  },
});
export type SwitchLogSearch = Static<typeof SwitchLogSearchSchema>;

export const ThrottleEventSearchSchema = listSearchSchema({
  sorts: ["createdAt", "statusCode"],
  filters: {
    route: Type.Optional(Type.Enum(THROTTLE_ROUTES)),
    errorCode: Type.Optional(Type.Enum(LIMIT_CODES)),
    statusCode: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
  },
});
export type ThrottleEventSearch = Static<typeof ThrottleEventSearchSchema>;
