import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { getAbuseMetrics, listThrottleEvents } from "#/api/backoffice";
import {
  AbuseTotals,
  TopIpsTable,
  TopPatientsTable,
} from "#/components/modules/backoffice/AbuseSummary";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import {
  listSearchValidator,
  parseListSearch,
  ThrottleEventSearchSchema,
  toListQuery,
} from "#/components/modules/backoffice/table-search";
import { ThrottleEventTable } from "#/components/modules/backoffice/ThrottleEventTable";

const validateSearch = listSearchValidator(ThrottleEventSearchSchema);

export const Route = createFileRoute("/backoffice/abuso")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [metrics, events] = await Promise.all([
      getAbuseMetrics(),
      listThrottleEvents(toListQuery(deps)),
    ]);
    return { metrics, events };
  },
  component: AbusePage,
});

function AbusePage() {
  const { metrics, events } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader
        title="Abuso e limites"
        description="Bloqueios por IP e por paciente nas últimas 24 horas."
      />
      <div className="flex flex-col gap-6">
        <AbuseTotals metrics={metrics} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Pacientes com mais consultas" description="Somente o primeiro nome.">
            <TopPatientsTable rows={metrics.topPatients} />
          </Section>
          <Section
            title="IPs com mais requisições"
            description="Identificados por um hash, nunca pelo IP."
          >
            <TopIpsTable rows={metrics.topIps} />
          </Section>
        </div>
        <Section title="Requisições contadas">
          <ThrottleEventTable
            list={events}
            query={search}
            onQueryChange={(patch) =>
              void navigate({
                search: (previous) => parseListSearch(validateSearch, { ...previous, ...patch }),
              })
            }
          />
        </Section>
      </div>
    </>
  );
}
