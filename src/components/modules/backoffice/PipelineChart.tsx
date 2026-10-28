import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "#/components/ui/chart";
import { formatBRL } from "#/lib/money/money";
import type { PipelineBucket } from "#/server/modules/backoffice/backoffice.dto";

import { formatCompactBRL, formatShortDateTime } from "./backoffice-format";

type Series = "requestedCents" | "approvedCents" | "chosenCents";

const SERIES: Record<Series, { label: string; color: string }> = {
  requestedCents: { label: "Solicitado", color: "var(--chart-2)" },
  approvedCents: { label: "Aprovado", color: "var(--primary)" },
  chosenCents: { label: "Escolhido", color: "var(--success)" },
};

const config = SERIES satisfies ChartConfig;
const SERIES_KEYS: readonly Series[] = ["requestedCents", "approvedCents", "chosenCents"];

/** Requested, approved and chosen volume per bucket (RF-604); a data table backs it for screen readers. */
export function PipelineChart({ series, title }: { series: PipelineBucket[]; title: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">{title}</figcaption>
      <ChartContainer config={config} className="aspect-auto h-72 w-full" aria-hidden>
        <AreaChart data={series} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucketStart"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickFormatter={formatShortDateTime}
          />
          <YAxis tickLine={false} axisLine={false} width={84} tickFormatter={formatCompactBRL} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const start: unknown = payload[0]?.payload?.bucketStart;
                  return typeof start === "string" ? formatShortDateTime(start) : null;
                }}
                formatter={(value, name) => {
                  const key = SERIES_KEYS.find((series) => series === name);
                  return (
                    <span className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">
                        {key ? SERIES[key].label : name}
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {typeof value === "number" ? formatBRL(value) : value}
                      </span>
                    </span>
                  );
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {SERIES_KEYS.map((key) => (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              fill={`var(--color-${key})`}
              fillOpacity={0.12}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            {SERIES_KEYS.map((key) => (
              <th key={key} scope="col">
                {SERIES[key].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((bucket) => (
            <tr key={bucket.bucketStart}>
              <th scope="row">{formatShortDateTime(bucket.bucketStart)}</th>
              {SERIES_KEYS.map((key) => (
                <td key={key}>{formatBRL(bucket[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
