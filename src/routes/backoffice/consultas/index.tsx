import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { listConsultations, searchConsultationsByCpf } from "#/api/backoffice";
import { ConsultationTable } from "#/components/modules/backoffice/ConsultationTable";
import { CpfSearchForm } from "#/components/modules/backoffice/CpfSearchForm";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import {
  type ConsultationSearch,
  ConsultationSearchSchema,
  listSearchValidator,
  parseListSearch,
  toListQuery,
} from "#/components/modules/backoffice/table-search";
import { Button } from "#/components/ui/button";
import type { ListResponse } from "#/lib/list/list-contract";
import type { ConsultationListItem } from "#/server/modules/backoffice/backoffice.dto";

const validateSearch = listSearchValidator(ConsultationSearchSchema);

export const Route = createFileRoute("/backoffice/consultas/")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listConsultations(toListQuery(deps)),
  component: ConsultationsPage,
});

/**
 * A CPF search in progress: the CPF and its table state (sort, filters, search, page) stay in
 * memory and go out in the POST body, never in the URL (RF-617).
 */
type CpfResults = {
  cpf: string;
  search: ConsultationSearch;
  list: ListResponse<ConsultationListItem>;
};

function ConsultationsPage() {
  const list = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [cpfResults, setCpfResults] = useState<CpfResults | null>(null);

  async function searchByCpf(cpf: string, cpfSearch: ConsultationSearch) {
    const result = await searchConsultationsByCpf({ cpf, ...toListQuery(cpfSearch) });
    if (!result.ok) {
      toast.error(result.problem.title);
      return;
    }
    setCpfResults({ cpf, search: cpfSearch, list: result.value });
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
              active={cpfResults !== null}
              onSearch={(cpf) => searchByCpf(cpf, {})}
              onClear={() => setCpfResults(null)}
            />
            {cpfResults ? (
              <ConsultationTable
                caption="Consultas do CPF buscado"
                list={cpfResults.list}
                query={cpfResults.search}
                onQueryChange={(patch) =>
                  void searchByCpf(
                    cpfResults.cpf,
                    parseListSearch(validateSearch, { ...cpfResults.search, ...patch }),
                  )
                }
                searchLabel="Buscar nas consultas do CPF"
              />
            ) : null}
          </div>
        </Section>
        <Section title="Todas as consultas">
          <ConsultationTable
            caption="Consultas"
            list={list}
            query={search}
            searchLabel="Buscar"
            onQueryChange={(patch) =>
              void navigate({
                search: (previous) => parseListSearch(validateSearch, { ...previous, ...patch }),
              })
            }
            toolbar={
              search.patientId ? (
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    void navigate({
                      search: (previous) =>
                        parseListSearch(validateSearch, {
                          ...previous,
                          patientId: undefined,
                          page: undefined,
                        }),
                    })
                  }
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
