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
import { useServerList } from "#/components/modules/backoffice/use-server-list";

const validateSearch = listSearchValidator(ThrottleEventSearchSchema);

// The events table loads its rows in the page (`useServerList`); the loader reads only the
// metrics, so paging the table neither re-runs it nor moves the page.
export const Route = createFileRoute("/backoffice/abuso")({
  validateSearch,
  loader: () => getAbuseMetrics(),
  component: AbusePage,
});

function AbusePage() {
  const metrics = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const events = useServerList(toListQuery(search), listThrottleEvents);

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
                resetScroll: false,
              })
            }
          />
        </Section>
      </div>
    </>
  );
}
