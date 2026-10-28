import { and, asc, desc, ilike, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { LIST_DEFAULTS, type ListResponse, SORT_PATTERN } from "#/lib/list/list-contract";
import { DomainError, type FieldError } from "#/server/lib/errors/domain-error";

type Expression = AnyPgColumn | SQL;

/** Turns the raw query string value into the typed filter value, or `undefined` when invalid. */
type ParseFilter = (raw: string) => unknown;

export type FilterSpec = {
  column: Expression;
  /** `eq` reads `<name>`; `range` reads `<name>From` and `<name>To` (inclusive). */
  kind: "eq" | "range";
  parse: ParseFilter;
};

/** An endpoint's allow-lists. Anything not listed here is rejected with 422 (RF-616). */
export type ListSpec = {
  filters: Record<string, FilterSpec>;
  sorts: Record<string, Expression>;
  search: Expression[];
  defaultSort: string;
  /** Appended to every ORDER BY so pages are stable. */
  tiebreaker: AnyPgColumn;
};

type ParsedFilter = { column: Expression; op: "eq" | "gte" | "lte"; value: unknown };

export type ParsedListQuery = {
  page: number;
  pageSize: number;
  sort: { field: string; direction: "asc" | "desc" };
  q: string | undefined;
  filters: ParsedFilter[];
};

const RESERVED: Record<string, true> = { page: true, pageSize: true, sort: true, q: true };
const sortPattern = new RegExp(SORT_PATTERN);

/** Validates a raw list query against an allow-list; throws VALIDATION naming each bad param. */
export function parseListQuery(raw: Record<string, unknown>, spec: ListSpec): ParsedListQuery {
  const fields: FieldError[] = [];
  const page = parseBoundedInt(raw.page, LIST_DEFAULTS.page, 1, Number.MAX_SAFE_INTEGER);
  if (page === undefined) fields.push({ path: "page", message: "Página inválida" });
  const pageSize = parseBoundedInt(
    raw.pageSize,
    LIST_DEFAULTS.pageSize,
    1,
    LIST_DEFAULTS.maxPageSize,
  );
  if (pageSize === undefined) {
    fields.push({
      path: "pageSize",
      message: `Tamanho de página deve estar entre 1 e ${LIST_DEFAULTS.maxPageSize}`,
    });
  }

  const sortRaw = raw.sort === undefined ? spec.defaultSort : (scalarText(raw.sort) ?? "");
  const [sortField = "", sortDirection] = sortRaw.split(":");
  if (!sortPattern.test(sortRaw) || !(sortField in spec.sorts)) {
    fields.push({ path: "sort", message: "Ordenação não permitida" });
  }

  const q = raw.q === undefined ? undefined : (scalarText(raw.q) ?? "").trim();
  if (q !== undefined && q.length > 100) {
    fields.push({ path: "q", message: "Busca deve ter no máximo 100 caracteres" });
  }

  const filters: ParsedFilter[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (RESERVED[name] || value === undefined || value === "") continue;
    const match = resolveFilter(name, spec);
    if (!match) {
      fields.push({ path: name, message: "Filtro não permitido" });
      continue;
    }
    const text = scalarText(value);
    const parsed = text === undefined ? undefined : match.filter.parse(text);
    if (parsed === undefined) {
      fields.push({ path: name, message: "Valor de filtro inválido" });
      continue;
    }
    filters.push({ column: match.filter.column, op: match.op, value: parsed });
  }

  if (fields.length > 0)
    throw new DomainError("VALIDATION", "Parâmetros de lista inválidos.", fields);
  return {
    page: page ?? LIST_DEFAULTS.page,
    pageSize: pageSize ?? LIST_DEFAULTS.pageSize,
    sort: { field: sortField, direction: sortDirection === "desc" ? "desc" : "asc" },
    q: q === "" ? undefined : q,
    filters,
  };
}

/** WHERE, ORDER BY (with the id tiebreaker), LIMIT and OFFSET for a parsed query. */
export function listClauses(parsed: ParsedListQuery, spec: ListSpec) {
  const conditions: SQL[] = parsed.filters.map(({ column, op, value }) =>
    op === "eq"
      ? sql`${column} = ${value}`
      : op === "gte"
        ? sql`${column} >= ${value}`
        : sql`${column} <= ${value}`,
  );
  if (parsed.q && spec.search.length > 0) {
    const pattern = `%${parsed.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const matches = spec.search.map((column) => ilike(sql`${column}::text`, pattern));
    const anyMatch = or(...matches);
    if (anyMatch) conditions.push(anyMatch);
  }
  const direction = parsed.sort.direction === "desc" ? desc : asc;
  return {
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [direction(spec.sorts[parsed.sort.field]), direction(spec.tiebreaker)],
    limit: parsed.pageSize,
    offset: (parsed.page - 1) * parsed.pageSize,
  };
}

export function toListResponse<Item>(
  items: Item[],
  total: number,
  parsed: ParsedListQuery,
): ListResponse<Item> {
  return {
    items,
    page: parsed.page,
    pageSize: parsed.pageSize,
    total,
    totalPages: Math.ceil(total / parsed.pageSize),
  };
}

/** Filter parsers for the common column kinds. */
export const parseFilter = {
  oneOf:
    <const Values extends readonly string[]>(values: Values): ParseFilter =>
    (raw) =>
      values.includes(raw) ? raw : undefined,
  boolean: (): ParseFilter => (raw) =>
    raw === "true" ? true : raw === "false" ? false : undefined,
  integer: (): ParseFilter => (raw) => (/^-?\d+$/.test(raw) ? Number(raw) : undefined),
  /** An ISO-8601 date or timestamp. */
  instant: (): ParseFilter => (raw) => {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  },
  uuid: (): ParseFilter => (raw) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : undefined,
};

function resolveFilter(
  name: string,
  spec: ListSpec,
): { filter: FilterSpec; op: ParsedFilter["op"] } | undefined {
  const exact = spec.filters[name];
  if (exact?.kind === "eq") return { filter: exact, op: "eq" };
  for (const [suffix, op] of [
    ["From", "gte"],
    ["To", "lte"],
  ] as const) {
    if (!name.endsWith(suffix)) continue;
    const range = spec.filters[name.slice(0, -suffix.length)];
    if (range?.kind === "range") return { filter: range, op };
  }
  return undefined;
}

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number) {
  if (raw === undefined || raw === "") return fallback;
  const text = scalarText(raw);
  const value = text === undefined ? Number.NaN : Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** A query value as text; arrays and objects (repeated or nested params) are invalid. */
function scalarText(raw: unknown): string | undefined {
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
}
