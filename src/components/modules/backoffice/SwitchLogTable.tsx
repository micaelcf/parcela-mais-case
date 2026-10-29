import { createColumnHelper } from "@tanstack/react-table";

import { LENDER_NAME } from "#/components/modules/consultation/lender-copy";
import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import { Badge } from "#/components/ui/badge";
import { LENDER_CODES } from "#/lib/enums";
import type { SwitchLogItem } from "#/server/modules/backoffice/backoffice.dto";

import { formatDateTime } from "./backoffice-format";
import {
  DataTable,
  type DataTableFeatures,
  type DataTableFilter,
  type DataTableQuery,
  type DataTableQueryPatch,
} from "./DataTable";
import type { ServerList } from "./use-server-list";

const column = createColumnHelper<DataTableFeatures, SwitchLogItem>();

const columns = column.columns([
  column.accessor("createdAt", {
    header: "Quando",
    cell: (info) => <span className="tabular-nums">{formatDateTime(info.getValue())}</span>,
  }),
  column.accessor("lender", {
    header: "Financeira",
    cell: (info) => <LenderIdentity lender={info.getValue()} size="sm" />,
  }),
  column.accessor("enabled", {
    header: "Ação",
    enableSorting: false,
    cell: (info) =>
      info.getValue() ? (
        <Badge variant="secondary">Ativada</Badge>
      ) : (
        <Badge variant="destructive">Desativada</Badge>
      ),
  }),
  column.accessor("actor", { header: "Operador", enableSorting: false }),
]);

const filters: DataTableFilter[] = [
  {
    id: "lender",
    label: "Financeira",
    kind: "select",
    options: LENDER_CODES.map((code) => ({ value: code, label: LENDER_NAME[code] })),
  },
  {
    id: "enabled",
    label: "Ação",
    kind: "select",
    options: [
      { value: true, label: "Ativada" },
      { value: false, label: "Desativada" },
    ],
  },
];

/** Every kill-switch change with its actor and time (RF-609), server-paged. */
export function SwitchLogTable({
  list,
  query,
  onQueryChange,
}: {
  list: ServerList<SwitchLogItem>;
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
}) {
  return (
    <DataTable
      caption="Histórico de ativação das financeiras"
      columns={columns}
      list={list}
      getRowId={(row) => row.id}
      query={query}
      onQueryChange={onQueryChange}
      search={{ label: "Buscar operador" }}
      filters={filters}
      noun={{ one: "alteração", other: "alterações" }}
      empty={{
        none: "Nenhuma alteração registrada.",
        filtered: "Nenhuma alteração encontrada para estes filtros.",
      }}
    />
  );
}
