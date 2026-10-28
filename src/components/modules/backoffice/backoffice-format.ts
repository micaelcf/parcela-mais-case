import type { QuoteStatus, SimulationScenario } from "#/lib/enums";
import { formatBRL } from "#/lib/money/money";
import type { LimitCode } from "#/server/modules/backoffice/backoffice.dto";
import type { JourneyStatus } from "#/server/modules/consultation/consultation.dto";

/** Display-only formatting for the backoffice: every figure comes computed from the API. */

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });
const SHORT_DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const COUNT = new Intl.NumberFormat("pt-BR");
const PERCENT = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const COMPACT_BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** What a missing figure shows (no data in the range). */
export const EMPTY = "—";

/** `"2026-10-28T11:05:00.000Z"` → `"28/10/2026, 08:05:00"` (local time). */
export function formatDateTime(iso: string | null): string {
  return iso ? DATE_TIME.format(new Date(iso)) : EMPTY;
}

/** A chart axis tick: `"28/10, 08:00"`. */
export function formatShortDateTime(iso: string): string {
  return SHORT_DATE_TIME.format(new Date(iso));
}

/** A calendar day `"1990-05-17"` → `"17/05/1990"` (no time zone shift). */
export function formatCalendarDate(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** `1234` → `"1.234"`. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** A 0–1 ratio → `"62,5%"`; null → `"—"`. */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? EMPTY : PERCENT.format(ratio).replace(/[\u00a0\u202f]/g, " ");
}

/** Milliseconds, rounded: `1234.5` → `"1.235 ms"`; null → `"—"`. */
export function formatMs(ms: number | null): string {
  return ms === null ? EMPTY : `${COUNT.format(Math.round(ms))} ms`;
}

/** Cents → `"R$ 1.234,56"`; null → `"—"`. */
export function formatOptionalBRL(cents: number | null): string {
  return cents === null ? EMPTY : formatBRL(cents);
}

/** A chart axis tick in BRL: `"R$ 12,5 mil"`. */
export function formatCompactBRL(cents: number): string {
  return COMPACT_BRL.format(cents / 100).replace(/[\u00a0\u202f]/g, " ");
}

export const JOURNEY_STATUS_LABEL: Record<JourneyStatus, string> = {
  QUOTING: "Consultando",
  OFFERS: "Com ofertas",
  NO_OFFER: "Sem oferta",
  CHOSEN: "Oferta escolhida",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  QUOTING: "Em andamento",
  SETTLED: "Concluída",
};

export const SCENARIO_LABEL: Record<SimulationScenario, string> = {
  NORMAL: "Normal",
  ALL_APPROVE: "Todas aprovam",
  DELTA_FAILS: "Delta falha",
  DELTA_TIMES_OUT: "Delta não responde",
  NONE_APPROVE: "Nenhuma aprova",
};

export const LIMIT_LABEL: Record<LimitCode, string> = {
  IP_LIMIT: "Limite por IP",
  PATIENT_LIMIT: "Limite por paciente",
};
