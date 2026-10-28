import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { QUOTE_STATUSES, SIMULATION_SCENARIOS } from "#/lib/enums";
import type { ListResponse } from "#/lib/list/list-contract";
import { formatBRL } from "#/lib/money/money";
import type { ConsultationListItem } from "#/server/modules/backoffice/backoffice.dto";
import {
  JOURNEY_STATUSES,
  type JourneyStatus,
} from "#/server/modules/consultation/consultation.dto";

import {
  formatDateTime,
  JOURNEY_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  SCENARIO_LABEL,
} from "./backoffice-format";
import {
  DataTable,
  type DataTableFeatures,
  type DataTableFilter,
  type DataTableQuery,
  type DataTableQueryPatch,
} from "./DataTable";

const STATUS_VARIANT: Record<JourneyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  QUOTING: "outline",
  OFFERS: "secondary",
  NO_OFFER: "destructive",
  CHOSEN: "default",
};

/** A journey status as a badge. */
export function JourneyStatusBadge({ status }: { status: JourneyStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{JOURNEY_STATUS_LABEL[status]}</Badge>;
}

const column = createColumnHelper<DataTableFeatures, ConsultationListItem>();

const columns = column.columns([
  column.accessor("patientName", {
    header: "Paciente",
    enableSorting: false,
    cell: (info) => (
      <Link
        to="/backoffice/consultas/$consultationId"
        params={{ consultationId: info.row.original.id }}
        className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  column.accessor("treatmentAmountCents", {
    header: "Valor",
    cell: (info) => <span className="tabular-nums">{formatBRL(info.getValue())}</span>,
  }),
  column.accessor("status", {
    header: "Situação",
    cell: (info) => <JourneyStatusBadge status={info.getValue()} />,
  }),
  column.accessor("simulationScenario", {
    header: "Cenário",
    enableSorting: false,
    cell: (info) => SCENARIO_LABEL[info.getValue()],
  }),
  column.accessor("createdAt", {
    header: "Criada em",
    cell: (info) => <span className="tabular-nums">{formatDateTime(info.getValue())}</span>,
  }),
  column.accessor("settledAt", {
    header: "Concluída em",
    cell: (info) => <span className="tabular-nums">{formatDateTime(info.getValue())}</span>,
  }),
]);

const filters: DataTableFilter[] = [
  {
    id: "status",
    label: "Situação",
    kind: "select",
    options: JOURNEY_STATUSES.map((status) => ({
      value: status,
      label: JOURNEY_STATUS_LABEL[status],
    })),
  },
  {
    id: "quoteStatus",
    label: "Cotação",
    kind: "select",
    options: QUOTE_STATUSES.map((status) => ({ value: status, label: QUOTE_STATUS_LABEL[status] })),
  },
  {
    id: "simulationScenario",
    label: "Cenário",
    kind: "select",
    options: SIMULATION_SCENARIOS.map((scenario) => ({
      value: scenario,
      label: SCENARIO_LABEL[scenario],
    })),
  },
  { id: "createdAtFrom", label: "Criada de", kind: "date" },
  { id: "createdAtTo", label: "Criada até", kind: "date" },
];

/**
 * Consultations, server-paged (RF-611, RF-615). The explorer passes search and filters; the CPF
 * search passes neither and turns sorting off (its endpoint takes only page and page size).
 */
export function ConsultationTable({
  caption,
  list,
  query,
  onQueryChange,
  explorer,
  toolbar,
}: {
  caption: string;
  list: ListResponse<ConsultationListItem>;
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
  /** Search box, filters and sorting: the explorer's controls. */
  explorer: boolean;
  toolbar?: ReactNode;
}) {
  return (
    <DataTable
      caption={caption}
      columns={columns}
      data={list.items}
      getRowId={(row) => row.id}
      page={list}
      query={query}
      onQueryChange={onQueryChange}
      search={explorer ? { label: "Buscar", placeholder: "Nome do paciente ou ID" } : undefined}
      filters={explorer ? filters : []}
      enableSorting={explorer}
      noun={{ one: "consulta", other: "consultas" }}
      emptyMessage="Nenhuma consulta encontrada."
      toolbar={toolbar}
    />
  );
}
