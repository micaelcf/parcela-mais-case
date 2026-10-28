import { createColumnHelper } from "@tanstack/react-table";

import { Badge } from "#/components/ui/badge";
import type { ListResponse } from "#/lib/list/list-contract";
import {
  LIMIT_CODES,
  THROTTLE_ROUTES,
  type ThrottleEventItem,
} from "#/server/modules/backoffice/backoffice.dto";

import { EMPTY, formatDateTime, LIMIT_LABEL } from "./backoffice-format";
import {
  DataTable,
  type DataTableFeatures,
  type DataTableFilter,
  type DataTableQuery,
  type DataTableQueryPatch,
} from "./DataTable";

type ThrottleRoute = (typeof THROTTLE_ROUTES)[number];

const ROUTE_LABEL: Record<ThrottleRoute, string> = {
  "consultation.create": "Nova consulta",
  "consultation.requote": "Nova cotação",
  "address.lookup": "Busca de CEP",
};

const column = createColumnHelper<DataTableFeatures, ThrottleEventItem>();

const columns = column.columns([
  column.accessor("createdAt", {
    header: "Quando",
    cell: (info) => <span className="tabular-nums">{formatDateTime(info.getValue())}</span>,
  }),
  column.accessor("route", {
    header: "Rota",
    enableSorting: false,
    cell: (info) => ROUTE_LABEL[info.getValue()],
  }),
  column.accessor("ipHash", {
    header: "IP (hash)",
    enableSorting: false,
    cell: (info) => <span className="font-mono">{info.getValue()}</span>,
  }),
  column.accessor("statusCode", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();
      if (status === null) return EMPTY;
      return <Badge variant={status === 429 ? "destructive" : "secondary"}>{status}</Badge>;
    },
  }),
  column.accessor("errorCode", {
    header: "Limite",
    enableSorting: false,
    cell: (info) => {
      const code = LIMIT_CODES.find((limit) => limit === info.getValue());
      return code ? LIMIT_LABEL[code] : (info.getValue() ?? EMPTY);
    },
  }),
]);

const filters: DataTableFilter[] = [
  {
    id: "route",
    label: "Rota",
    kind: "select",
    options: THROTTLE_ROUTES.map((route) => ({ value: route, label: ROUTE_LABEL[route] })),
  },
  {
    id: "errorCode",
    label: "Limite",
    kind: "select",
    options: LIMIT_CODES.map((code) => ({ value: code, label: LIMIT_LABEL[code] })),
  },
  {
    id: "statusCode",
    label: "Status",
    kind: "select",
    options: [
      { value: 202, label: "202" },
      { value: 429, label: "429" },
    ],
  },
];

/** Every counted create/requote request, server-paged (RF-614, RF-615). */
export function ThrottleEventTable({
  list,
  query,
  onQueryChange,
}: {
  list: ListResponse<ThrottleEventItem>;
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
}) {
  return (
    <DataTable
      caption="Requisições contadas pelos limites"
      columns={columns}
      data={list.items}
      getRowId={(row) => row.id}
      page={list}
      query={query}
      onQueryChange={onQueryChange}
      search={{ label: "Buscar", placeholder: "Código ou rota" }}
      filters={filters}
      noun={{ one: "requisição", other: "requisições" }}
      emptyMessage="Nenhuma requisição registrada."
    />
  );
}
