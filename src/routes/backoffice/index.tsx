import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { getLenderMetrics, getPipelineMetrics } from "#/api/backoffice";
import { LenderHealthTable } from "#/components/modules/backoffice/LenderHealthTable";
import {
  DEFAULT_PERIOD,
  PERIOD,
  PeriodSearchSchema,
  periodRange,
} from "#/components/modules/backoffice/metrics-period";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import { PeriodPicker } from "#/components/modules/backoffice/PeriodPicker";
import { PipelineChart } from "#/components/modules/backoffice/PipelineChart";
import {
  ChosenByLenderTable,
  PipelineTotals,
} from "#/components/modules/backoffice/PipelineSummary";
import { listSearchValidator } from "#/components/modules/backoffice/table-search";
import { buttonVariants } from "#/components/ui/button";

export const Route = createFileRoute("/backoffice/")({
  validateSearch: listSearchValidator(PeriodSearchSchema),
  loaderDeps: ({ search }) => ({ period: search.periodo ?? DEFAULT_PERIOD }),
  loader: async ({ deps }) => {
    const range = periodRange(deps.period, new Date());
    const [pipeline, lenders] = await Promise.all([
      getPipelineMetrics({ ...range, bucket: PERIOD[deps.period].bucket }),
      getLenderMetrics(range),
    ]);
    return { period: deps.period, pipeline, lenders };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { period, pipeline, lenders } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader
        title="Painel"
        description="Funil de dinheiro e saúde das financeiras."
        actions={
          <PeriodPicker
            value={period}
            onChange={(next) =>
              void navigate({ search: { periodo: next === DEFAULT_PERIOD ? undefined : next } })
            }
          />
        }
      />
      <div className="flex flex-col gap-6">
        <PipelineTotals totals={pipeline.totals} />
        <Section
          title="Volume no tempo"
          description={`Solicitado, aprovado e escolhido · ${PERIOD[period].label.toLowerCase()}`}
        >
          <PipelineChart series={pipeline.series} title="Volume solicitado, aprovado e escolhido" />
        </Section>
        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Escolhido por financeira">
            <ChosenByLenderTable rows={pipeline.chosenByLender} />
          </Section>
          <div className="lg:col-span-2">
            <Section title="Saúde das financeiras" description="Latência, desfechos e disjuntor.">
              <LenderHealthTable lenders={lenders.lenders} />
              <Link
                to="/backoffice/financeiras"
                className={buttonVariants({ variant: "link", className: "mt-2 px-0" })}
              >
                Gerenciar financeiras
              </Link>
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
