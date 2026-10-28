import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { listConsultations, searchConsultationsByCpf } from "#/api/backoffice";
import { ConsultationTable } from "#/components/modules/backoffice/ConsultationTable";
import { CpfSearchForm } from "#/components/modules/backoffice/CpfSearchForm";
import { PageHeader, Section } from "#/components/modules/backoffice/PageHeader";
import {
  ConsultationSearchSchema,
  listSearchValidator,
  parseListSearch,
  toListQuery,
} from "#/components/modules/backoffice/table-search";
import { Button } from "#/components/ui/button";
import { LIST_DEFAULTS, type ListResponse } from "#/lib/list/list-contract";
import type { ConsultationListItem } from "#/server/modules/backoffice/backoffice.dto";

const validateSearch = listSearchValidator(ConsultationSearchSchema);

export const Route = createFileRoute("/backoffice/consultas/")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listConsultations(toListQuery(deps)),
  component: ConsultationsPage,
});

/** A CPF search in progress: the CPF stays in memory, never in the URL. */
type CpfResults = {
  cpf: string;
  list: ListResponse<ConsultationListItem>;
};

function ConsultationsPage() {
  const list = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [cpfResults, setCpfResults] = useState<CpfResults | null>(null);

  async function searchByCpf(cpf: string, page = 1, pageSize: number = LIST_DEFAULTS.pageSize) {
    const result = await searchConsultationsByCpf({ cpf, page, pageSize });
    if (!result.ok) {
      toast.error(result.problem.title);
      return;
    }
    setCpfResults({ cpf, list: result.value });
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
              onSearch={(cpf) => searchByCpf(cpf)}
              onClear={() => setCpfResults(null)}
            />
            {cpfResults ? (
              <ConsultationTable
                caption="Consultas do CPF buscado"
                list={cpfResults.list}
                query={{ page: cpfResults.list.page, pageSize: cpfResults.list.pageSize }}
                onQueryChange={(patch) =>
                  void searchByCpf(
                    cpfResults.cpf,
                    typeof patch.page === "number" ? patch.page : 1,
                    typeof patch.pageSize === "number" ? patch.pageSize : LIST_DEFAULTS.pageSize,
                  )
                }
                explorer={false}
              />
            ) : null}
          </div>
        </Section>
        <Section title="Todas as consultas">
          <ConsultationTable
            caption="Consultas"
            list={list}
            query={search}
            explorer
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
