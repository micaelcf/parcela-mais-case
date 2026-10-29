import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { listConsultations, searchConsultationsByCpf } from "#/api/backoffice";
import { ConsultationTable } from "#/components/modules/backoffice/ConsultationTable";
import { CpfSearchForm } from "#/components/modules/backoffice/CpfSearchForm";
import type { DataTableQueryPatch } from "#/components/modules/backoffice/DataTable";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import {
  type ConsultationSearch,
  ConsultationSearchSchema,
  listSearchValidator,
  parseListSearch,
  toListQuery,
} from "#/components/modules/backoffice/table-search";
import { useServerList } from "#/components/modules/backoffice/use-server-list";
import { Button } from "#/components/ui/button";

const validateSearch = listSearchValidator(ConsultationSearchSchema);

// The explorer's rows load in the page (`useServerList`), not in a loader keyed on the search:
// paging, sorting and filtering then keep the page mounted and in place.
export const Route = createFileRoute("/backoffice/consultas/")({
  validateSearch,
  component: ConsultationsPage,
});

/** A submitted CPF search; `id` tells a new submit of the same CPF apart (it starts over). */
type CpfSearch = { id: number; cpf: string };

function ConsultationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const list = useServerList(toListQuery(search), listConsultations);
  const [cpfSearch, setCpfSearch] = useState<CpfSearch | null>(null);

  function applyQuery(patch: DataTableQueryPatch) {
    void navigate({
      search: (previous) => parseListSearch(validateSearch, { ...previous, ...patch }),
      resetScroll: false,
    });
  }

  return (
    <>
      <PageHeader title="Consultas" description="Todas as consultas de pré-aprovação." />
      <div className="flex flex-col gap-6">
        <Section
          title="Buscar por CPF"
          description="Encontra as consultas de um paciente pelo CPF completo."
        >
          <div className="flex flex-col gap-4">
            <CpfSearchForm
              active={cpfSearch !== null}
              onSearch={async (cpf) =>
                setCpfSearch((previous) => ({ id: (previous?.id ?? 0) + 1, cpf }))
              }
              onClear={() => setCpfSearch(null)}
            />
            {cpfSearch ? <CpfResultsTable key={cpfSearch.id} cpf={cpfSearch.cpf} /> : null}
          </div>
        </Section>
        <Section title="Todas as consultas">
          <ConsultationTable
            caption="Consultas"
            list={list}
            query={search}
            searchLabel="Buscar"
            onQueryChange={applyQuery}
            toolbar={
              search.patientId ? (
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => applyQuery({ patientId: undefined, page: undefined })}
                >
                  <XIcon aria-hidden data-icon="inline-start" />
                  Remover filtro de paciente
                </Button>
              ) : null
            }
          />
        </Section>
      </div>
    </>
  );
}

/**
 * The consultations of one CPF. The CPF and this table's state (sort, filters, search, page) stay
 * in memory and go out in the POST body, never in the URL (RF-617).
 */
function CpfResultsTable({ cpf }: { cpf: string }) {
  const [search, setSearch] = useState<ConsultationSearch>({});
  const list = useServerList({ cpf, ...toListQuery(search) }, async (body) => {
    const result = await searchConsultationsByCpf(body);
    if (!result.ok) throw new Error(result.problem.title);
    return result.value;
  });

  return (
    <ConsultationTable
      caption="Consultas do CPF buscado"
      list={list}
      query={search}
      onQueryChange={(patch) =>
        setSearch((previous) => parseListSearch(validateSearch, { ...previous, ...patch }))
      }
      searchLabel="Buscar nas consultas do CPF"
    />
  );
}
