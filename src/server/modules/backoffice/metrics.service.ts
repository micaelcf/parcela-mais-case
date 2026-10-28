import { LENDER_CODES } from "#/lib/enums";
import { DomainError, type FieldError } from "#/server/lib/errors/domain-error";
import { lenderAttemptService } from "#/server/modules/lender/lender-attempt.service";
import { lenderSettingService } from "#/server/modules/lender/lender-setting.service";

import {
  type AbuseMetrics,
  firstNameOf,
  type LenderMetrics,
  type MetricBucket,
  type MetricsRangeQuery,
  type PipelineMetrics,
  type PipelineQuery,
} from "./backoffice.dto";
import { type MetricRange, metricsRepository } from "./metrics.repository";

const DAY_MS = 24 * 60 * 60_000;

/** Bucket widths in UTC (epoch 0 is a UTC midnight, so flooring by the width truncates). */
const BUCKET_MS: Record<MetricBucket, number> = { day: DAY_MS, hour: 60 * 60_000 };

/** A series longer than this (e.g. a year in hours) is refused rather than built. */
const MAX_BUCKETS = 1_000;

/** Rows in the abuse view's top lists. */
const TOP_LIMIT = 10;

function invalidRange(fields: FieldError[]): DomainError {
  return new DomainError("VALIDATION", "Período inválido.", fields);
}

/** `[from, to)` from the query; both default to the last 24 h ending now. */
function resolveRange(query: MetricsRangeQuery, now: Date = new Date()): MetricRange {
  const fields: FieldError[] = [];
  const parse = (raw: string | undefined, path: "from" | "to"): Date | undefined => {
    if (raw === undefined) return undefined;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      fields.push({ path, message: "Informe uma data e hora ISO-8601" });
      return undefined;
    }
    return date;
  };
  const parsedTo = parse(query.to, "to");
  const parsedFrom = parse(query.from, "from");
  if (fields.length > 0) throw invalidRange(fields);
  const to = parsedTo ?? now;
  const from = parsedFrom ?? new Date(to.getTime() - DAY_MS);
  if (from.getTime() >= to.getTime()) {
    throw invalidRange([{ path: "from", message: "O início deve ser anterior ao fim" }]);
  }
  return { from, to };
}

/** `numerator ÷ denominator`, or null when there is nothing to divide by. */
const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;

/** Rounded mean of `count` values summing to `sum`; null with none. */
const roundedMean = (sum: number, count: number) => (count === 0 ? null : Math.round(sum / count));

export const metricsService = {
  /** Money pipeline (RF-604/605): zero-filled UTC series plus totals, ratios and chosen averages. */
  async pipeline(query: PipelineQuery): Promise<PipelineMetrics> {
    const range = resolveRange(query);
    const bucket = query.bucket ?? "hour";
    const width = BUCKET_MS[bucket];
    const firstStart = Math.floor(range.from.getTime() / width) * width;
    if ((range.to.getTime() - firstStart) / width > MAX_BUCKETS) {
      throw invalidRange([
        { path: "bucket", message: `O período tem mais de ${MAX_BUCKETS} intervalos` },
      ]);
    }

    const [rows, totals, chosen] = await Promise.all([
      metricsRepository.pipelineSeries(range, bucket),
      metricsRepository.pipelineTotals(range),
      metricsRepository.chosenByLender(range),
    ]);

    const byStart = new Map(rows.map((row) => [row.bucketStart.getTime(), row]));
    const series: PipelineMetrics["series"] = [];
    for (let start = firstStart; start < range.to.getTime(); start += width) {
      const row = byStart.get(start);
      series.push({
        bucketStart: new Date(start).toISOString(),
        consultations: row?.consultations ?? 0,
        requestedCents: row?.requestedCents ?? 0,
        approvedCents: row?.approvedCents ?? 0,
        chosenCents: row?.chosenCents ?? 0,
      });
    }

    const chosenRows = new Map(chosen.map((row) => [row.lender, row]));
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      bucket,
      series,
      totals: {
        consultations: totals.consultations,
        requestedCents: totals.requestedCents,
        approvedCents: totals.approvedCents,
        chosenCents: totals.chosenCents,
        settledConsultations: totals.settledConsultations,
        approvedConsultations: totals.approvedConsultations,
        approvalRate: ratio(totals.approvedConsultations, totals.settledConsultations),
        approvedRequestedRatio: ratio(totals.settledApprovedCents, totals.settledRequestedCents),
        chosenOffers: totals.chosenOffers,
        avgChosenInstallmentCents: roundedMean(totals.chosenInstallmentCents, totals.chosenOffers),
        avgChosenTotalCents: roundedMean(totals.chosenTotalCents, totals.chosenOffers),
      },
      chosenByLender: LENDER_CODES.map((lender) => ({
        lender,
        chosenOffers: chosenRows.get(lender)?.chosenOffers ?? 0,
        chosenCents: chosenRows.get(lender)?.chosenCents ?? 0,
      })),
    };
  },

  /** Lender health (RF-606/607/610): outcomes over attempts settled in the range, plus live state. */
  async lenders(query: MetricsRangeQuery): Promise<LenderMetrics> {
    const range = resolveRange(query);
    const [outcomes, settings, breakers, backlog] = await Promise.all([
      metricsRepository.lenderOutcomes(range),
      lenderSettingService.list(),
      lenderAttemptService.breakerStates(),
      metricsRepository.queueBacklog(),
    ]);
    const outcomeOf = new Map(outcomes.map((row) => [row.lender, row]));
    const enabledOf = new Map(settings.map((row) => [row.lender, row.enabled]));
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      lenders: LENDER_CODES.map((lender) => {
        const row = outcomeOf.get(lender);
        const settled = row?.settledAttempts ?? 0;
        const approved = row?.approved ?? 0;
        const refused = row?.refused ?? 0;
        const errors = row?.errors ?? 0;
        const timeouts = row?.timeouts ?? 0;
        return {
          lender,
          enabled: enabledOf.get(lender) ?? true,
          breaker: breakers[lender],
          queueBacklog: backlog[lender],
          settledAttempts: settled,
          calledAttempts: row?.calledAttempts ?? 0,
          p50LatencyMs: row?.p50LatencyMs ?? null,
          p95LatencyMs: row?.p95LatencyMs ?? null,
          approved,
          refused,
          errors,
          timeouts,
          approvalRate: ratio(approved, settled),
          refusalRate: ratio(refused, settled),
          errorRate: ratio(errors, settled),
          timeoutRate: ratio(timeouts, settled),
        };
      }),
    };
  },

  /** Abuse (RF-614): limit hits, 429s, top patients (id + first name) and top IP hashes. */
  async abuse(query: MetricsRangeQuery): Promise<AbuseMetrics> {
    const range = resolveRange(query);
    const [summary, topPatients, topIps] = await Promise.all([
      metricsRepository.throttleSummary(range),
      metricsRepository.topPatients(range, TOP_LIMIT),
      metricsRepository.topIps(range, TOP_LIMIT),
    ]);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      requests: summary.requests,
      limitHits: { IP_LIMIT: summary.ipLimit, PATIENT_LIMIT: summary.patientLimit },
      tooManyRequests: summary.tooManyRequests,
      topPatients: topPatients.map((row) => ({
        patientId: row.patientId,
        firstName: firstNameOf(row.fullName),
        consultations: row.consultations,
      })),
      topIps,
    };
  },
};
