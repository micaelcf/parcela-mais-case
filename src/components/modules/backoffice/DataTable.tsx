import {
  type ColumnDef,
  type ColumnFiltersState,
  columnFilteringFeature,
  functionalUpdate,
  globalFilteringFeature,
  type PaginationState,
  rowPaginationFeature,
  type RowData,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { LIST_DEFAULTS } from "#/lib/list/list-contract";

import { formatCount } from "./backoffice-format";
import { classifySearchText, sortingOf, sortOf } from "./table-search";

/** Every backoffice table pages, sorts and filters on the server (RF-615): all four stages manual. */
export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
});
export type DataTableFeatures = typeof dataTableFeatures;

type FilterValue = string | number | boolean;

/** A filter control above the table; `id` is the list API's top-level param. */
export type DataTableFilter =
  | {
      id: string;
      label: string;
      kind: "select";
      options: ReadonlyArray<{ value: FilterValue; label: string }>;
    }
  | { id: string; label: string; kind: "date" };

/** The table's server state as the URL (or a form) holds it. */
export type DataTableQuery = Readonly<Record<string, unknown>>;

/** A change to the table state; `undefined` removes a key. The owner validates and applies it. */
export type DataTableQueryPatch = Record<string, FilterValue | undefined>;

const PAGE_SIZES = [10, 20, 50, 100] as const;
const SEARCH_DEBOUNCE_MS = 400;
const CPF_HINT =
  "O CPF não entra nesta busca. Para encontrar um paciente pelo CPF, use “Buscar por CPF” em Consultas.";

type DataTableProps<TData extends RowData> = {
  /** The table's accessible name, shown above it. */
  caption: string;
  columns: Array<ColumnDef<DataTableFeatures, TData, any>>;
  data: ReadonlyArray<TData>;
  getRowId: (row: TData) => string;
  /** The list response's paging metadata. */
  page: { page: number; pageSize: number; total: number; totalPages: number };
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
  /** Free-text search (`q`); omitted when the list has none. */
  search?: { label: string; placeholder?: string };
  filters?: ReadonlyArray<DataTableFilter>;
  /** Shown next to the total: "consultas", "alterações"… */
  noun: { one: string; other: string };
  emptyMessage?: string;
  /** Extra controls next to the search box. */
  toolbar?: ReactNode;
};

/**
 * The one server-driven table (TanStack Table v9, manual pagination, sorting and filtering).
 * Table state is controlled from `query` (the route's search params, or component state for the
 * CPF search); every change becomes a patch for the owner to apply, which reloads the page of rows
 * from the API.
 */
export function DataTable<TData extends RowData>({
  caption,
  columns,
  data,
  getRowId,
  page,
  query,
  onQueryChange,
  search,
  filters = [],
  noun,
  emptyMessage = "Nenhum registro encontrado.",
  toolbar,
}: DataTableProps<TData>) {
  // The table object is stable while its rows change with each response; opt out of the React
  // Compiler so renders reading rows through it are never memoized on that stable reference.
  "use no memo";

  const pagination: PaginationState = {
    pageIndex: (typeof query.page === "number" ? query.page : LIST_DEFAULTS.page) - 1,
    pageSize: typeof query.pageSize === "number" ? query.pageSize : LIST_DEFAULTS.pageSize,
  };
  const sorting: SortingState = sortingOf(typeof query.sort === "string" ? query.sort : undefined);
  const globalFilter = typeof query.q === "string" ? query.q : "";
  const columnFilters: ColumnFiltersState = filters.flatMap((filter) =>
    query[filter.id] === undefined ? [] : [{ id: filter.id, value: query[filter.id] }],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
    rowCount: page.total,
    state: { pagination, sorting, globalFilter, columnFilters },
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, pagination);
      const sizeChanged = next.pageSize !== pagination.pageSize;
      onQueryChange({
        page: sizeChanged || next.pageIndex === 0 ? undefined : next.pageIndex + 1,
        pageSize: next.pageSize === LIST_DEFAULTS.pageSize ? undefined : next.pageSize,
      });
    },
    onSortingChange: (updater) => {
      onQueryChange({ sort: sortOf(functionalUpdate(updater, sorting)), page: undefined });
    },
    onGlobalFilterChange: (updater) => {
      const next: unknown = functionalUpdate(updater, globalFilter);
      const text = typeof next === "string" ? next.trim() : "";
      onQueryChange({ q: text === "" ? undefined : text, page: undefined });
    },
    onColumnFiltersChange: (updater) => {
      const next = functionalUpdate(updater, columnFilters);
      const patch: DataTableQueryPatch = { page: undefined };
      for (const filter of filters) {
        const value = next.find((entry) => entry.id === filter.id)?.value;
        patch[filter.id] =
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : undefined;
      }
      onQueryChange(patch);
    },
  });

  function setFilter(id: string, value: FilterValue | undefined) {
    table.setColumnFilters((current) => [
      ...current.filter((entry) => entry.id !== id),
      ...(value === undefined || value === "" ? [] : [{ id, value }]),
    ]);
  }

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const pageCount = Math.max(table.getPageCount(), 1);
  const currentPage = pagination.pageIndex + 1;

  return (
    <section className="flex flex-col gap-3">
      {search || filters.length > 0 || toolbar ? (
        <div className="flex flex-wrap items-end gap-3">
          {search ? (
            <SearchBox
              label={search.label}
              placeholder={search.placeholder}
              value={globalFilter}
              onSearch={(text) => table.setGlobalFilter(text)}
            />
          ) : null}
          {filters.map((filter) => (
            <FilterControl
              key={filter.id}
              filter={filter}
              value={query[filter.id]}
              onChange={(value) => setFilter(filter.id, value)}
            />
          ))}
          {toolbar}
        </div>
      ) : null}

      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {headerGroups.map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={
                      !canSort
                        ? undefined
                        : direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <table.FlexRender header={header} />
                        {direction === "asc" ? (
                          <ArrowUpIcon aria-hidden className="size-3.5" />
                        ) : direction === "desc" ? (
                          <ArrowDownIcon aria-hidden className="size-3.5" />
                        ) : (
                          <ArrowUpDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-20 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <nav
        aria-label={`Paginação: ${caption}`}
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <p aria-live="polite" className="text-muted-foreground">
          {formatCount(page.total)} {page.total === 1 ? noun.one : noun.other} · página{" "}
          {formatCount(currentPage)} de {formatCount(pageCount)}
        </p>
        <div className="flex items-center gap-2">
          <PageSizeSelect
            value={pagination.pageSize}
            onChange={(size) => table.setPageSize(size)}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Primeira página"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
          >
            <ChevronsLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Página anterior"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Próxima página"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Última página"
            disabled={!table.getCanNextPage()}
            onClick={() => table.lastPage()}
          >
            <ChevronsRightIcon aria-hidden />
          </Button>
        </div>
      </nav>
    </section>
  );
}

/**
 * The search box: applies after a pause in typing, or at once on Enter. Its text becomes the `q`
 * URL param, so a CPF is never applied (RF-617) and bare digits wait for Enter (see
 * `classifySearchText`).
 */
function SearchBox({
  label,
  placeholder,
  value,
  onSearch,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onSearch: (text: string) => void;
}) {
  const id = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(value);
  const kind = classifySearchText(draft);

  // The URL is the source of truth: a back/forward or a reset elsewhere refills the box.
  useEffect(() => setDraft(value), [value]);

  // The pending debounced search, cancelled by Enter: TanStack keeps this route mounted while the
  // next route's loader runs, so a timer left behind could navigate back to the list after the
  // user already clicked through to a detail page.
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (draft.trim() === value || kind === "cpf" || kind === "digits") return;
    pending.current = setTimeout(() => onSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(pending.current);
  }, [draft, kind, value, onSearch]);

  function submit(event: FormEvent) {
    event.preventDefault();
    clearTimeout(pending.current);
    if (kind !== "cpf" && draft.trim() !== value) onSearch(draft);
  }

  return (
    <form role="search" onSubmit={submit} className="flex min-w-64 flex-1 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="search"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
        aria-describedby={kind === "cpf" ? hintId : undefined}
        className="h-9"
      />
      {kind === "cpf" ? (
        <p id={hintId} role="status" className="text-sm text-muted-foreground">
          {CPF_HINT}
        </p>
      ) : null}
    </form>
  );
}

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: DataTableFilter;
  value: unknown;
  onChange: (value: FilterValue | undefined) => void;
}) {
  const id = useId();
  if (filter.kind === "date") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{filter.label}</Label>
        <Input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          className="h-9 w-40"
        />
      </div>
    );
  }
  const selected = filter.options.find((option) => option.value === value);
  const items: ReadonlyArray<{ value: FilterValue | null; label: string }> = [
    { value: null, label: "Todos" },
    ...filter.options,
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={`${id}-label`}>{filter.label}</Label>
      <Select<FilterValue | null>
        items={items}
        value={selected ? selected.value : null}
        onValueChange={(next: FilterValue | null) => onChange(next ?? undefined)}
      >
        <SelectTrigger aria-labelledby={`${id}-label`} className="h-9 min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={String(item.value)} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PageSizeSelect({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const id = useId();
  const items = PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));
  return (
    <div className="flex items-center gap-2">
      <Label id={`${id}-label`} className="font-normal text-muted-foreground">
        Itens por página
      </Label>
      <Select items={items} value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger aria-labelledby={`${id}-label`} size="sm" className="w-18">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
