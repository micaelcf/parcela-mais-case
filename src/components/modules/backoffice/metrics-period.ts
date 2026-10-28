import Type, { type Static } from "typebox";

import type { MetricBucket } from "#/server/modules/backoffice/backoffice.dto";

/** The dashboards' time window, kept in the URL as `?periodo=`. */
export const PERIODS = ["24h", "7d", "30d"] as const;
export type Period = (typeof PERIODS)[number];

export const PeriodSearchSchema = Type.Object({
  periodo: Type.Optional(Type.Enum(PERIODS)),
});
export type PeriodSearch = Static<typeof PeriodSearchSchema>;

export const DEFAULT_PERIOD: Period = "24h";

const HOUR_MS = 3_600_000;

export const PERIOD: Record<Period, { label: string; spanMs: number; bucket: MetricBucket }> = {
  "24h": { label: "Últimas 24 horas", spanMs: 24 * HOUR_MS, bucket: "hour" },
  "7d": { label: "Últimos 7 dias", spanMs: 7 * 24 * HOUR_MS, bucket: "day" },
  "30d": { label: "Últimos 30 dias", spanMs: 30 * 24 * HOUR_MS, bucket: "day" },
};

/** `[from, to)` ending now for a period, as the metrics endpoints take it. */
export function periodRange(period: Period, now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - PERIOD[period].spanMs).toISOString(),
    to: now.toISOString(),
  };
}
