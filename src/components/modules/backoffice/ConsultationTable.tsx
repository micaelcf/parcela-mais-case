import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { QUOTE_STATUSES, SIMULATION_SCENARIOS } from "#/lib/enums";
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
import type { ServerList } from "./use-server-list";

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
 * Consultations, paged, sorted, filtered and searched on the server (RF-611, RF-615): the explorer
 * keeps its state in the URL, the CPF search in component state (its CPF must never reach a URL).
 */
export function ConsultationTable({
  caption,
  list,
  query,
  onQueryChange,
  searchLabel,
  toolbar,
}: {
  caption: string;
  list: ServerList<ConsultationListItem>;
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
  /** The search box's label; distinct per table when both are on the page. */
  searchLabel: string;
  toolbar?: ReactNode;
}) {
  return (
    <DataTable
      caption={caption}
      columns={columns}
      list={list}
      getRowId={(row) => row.id}
      query={query}
      onQueryChange={onQueryChange}
      search={{ label: searchLabel, placeholder: "Nome do paciente ou ID" }}
      filters={filters}
      noun={{ one: "consulta", other: "consultas" }}
      empty={{
        none: "Nenhuma consulta ainda.",
        filtered: "Nenhuma consulta encontrada para estes filtros.",
      }}
      toolbar={toolbar}
    />
  );
}
