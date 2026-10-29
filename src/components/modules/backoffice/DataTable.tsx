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
  CircleAlertIcon,
  FunnelXIcon,
  InboxIcon,
  RotateCwIcon,
  SearchXIcon,
} from "lucide-react";
import { useDebouncer } from "@tanstack/react-pacer";
import { useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { DatePicker } from "#/components/ui/date-picker";
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
import { Skeleton } from "#/components/ui/skeleton";
import { LIST_DEFAULTS } from "#/lib/list/list-contract";

import { formatCount } from "./backoffice-format";
import { classifySearchText, sortingOf, sortOf } from "./table-search";
import { TableMessageRow } from "./TableMessageRow";
import type { ServerList } from "./use-server-list";

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
/** Placeholder rows while the first page loads (fewer than a full page keeps the jump small). */
const MAX_SKELETON_ROWS = 8;
/** Query keys that page or order the rows; every other key narrows them (search, filters). */
const LAYOUT_KEYS: Record<string, true> = { page: true, pageSize: true, sort: true };
const NO_ROWS: ReadonlyArray<never> = [];
/** How many years back a date filter's calendar offers (the app keeps nothing older). */
const DATE_FILTER_YEARS_BACK = 5;
const CPF_HINT =
  "O CPF não entra nesta busca. Para encontrar um paciente pelo CPF, use “Buscar por CPF” em Consultas.";

type DataTableProps<TData extends RowData> = {
  /** The table's accessible name, shown above it. */
  caption: string;
  columns: Array<ColumnDef<DataTableFeatures, TData, any>>;
  /** The rows of the current query, as `useServerList` loads them. */
  list: ServerList<TData>;
  getRowId: (row: TData) => string;
  query: DataTableQuery;
  onQueryChange: (patch: DataTableQueryPatch) => void;
  /** Free-text search (`q`); omitted when the list has none. */
  search?: { label: string; placeholder?: string };
  filters?: ReadonlyArray<DataTableFilter>;
  /** Shown next to the total: "consultas", "alterações"… */
  noun: { one: string; other: string };
  /** The empty state's title: with nothing narrowing the list, and when search or filters do. */
  empty: { none: string; filtered: string };
  /** Extra controls next to the search box. */
  toolbar?: ReactNode;
};

/**
 * The one server-driven table (TanStack Table v9, manual pagination, sorting and filtering).
 * Table state is controlled from `query` (the route's search params, or component state for the
 * CPF search); every change becomes a patch for the owner to apply, and `list` loads the matching
 * page of rows. Skeleton rows stand in for the first page; later pages load under the rows already
 * shown (dimmed, with a progress bar), so the table never blanks nor moves the page.
 */
export function DataTable<TData extends RowData>({
  caption,
  columns,
  list,
  getRowId,
  query,
  onQueryChange,
  search,
  filters = [],
  noun,
  empty,
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
  const response = list.response;
  // Search and filters (whatever the owner keeps besides paging and order): what the empty state
  // offers to clear.
  const narrowing = Object.keys(query).filter(
    (key) => !Object.hasOwn(LAYOUT_KEYS, key) && query[key] !== undefined,
  );
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: response?.items ?? NO_ROWS,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
    rowCount: response?.total ?? 0,
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
      // Only the filters that changed: two quick changes in a row (before the URL catches up)
      // must not write back the other one's stale value.
      const patch: DataTableQueryPatch = { page: undefined };
      for (const filter of filters) {
        const value = next.find((entry) => entry.id === filter.id)?.value;
        const known =
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : undefined;
        if (known !== query[filter.id]) patch[filter.id] = known;
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
  const refreshing = list.loading && response !== null;

  function clearNarrowing() {
    const patch: DataTableQueryPatch = { page: undefined };
    for (const key of narrowing) patch[key] = undefined;
    onQueryChange(patch);
  }

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

      {response !== null && list.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Não foi possível atualizar a lista</AlertTitle>
          <AlertDescription>{list.error} Mostrando os últimos dados carregados.</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={list.reload}>
              <RotateCwIcon aria-hidden data-icon="inline-start" />
              Tentar de novo
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <div className="relative">
        {refreshing ? (
          <div
            role="progressbar"
            aria-label={`Carregando ${noun.other}`}
            className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-primary/15 animate-in fade-in-0 delay-150 duration-300 fill-mode-backwards"
          >
            <div className="size-full animate-pulse bg-primary motion-reduce:animate-none" />
          </div>
        ) : null}
        <Table aria-busy={list.loading || undefined}>
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
                            <ArrowUpDownIcon
                              aria-hidden
                              className="size-3.5 text-muted-foreground"
                            />
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
          <TableBody
            className={cn(
              "transition-opacity duration-200 motion-reduce:transition-none",
              refreshing && "opacity-60 delay-150",
            )}
          >
            {response === null ? (
              list.error ? (
                <TableMessageRow
                  colSpan={columns.length}
                  icon={<CircleAlertIcon aria-hidden />}
                  title="Não foi possível carregar a lista"
                  description={list.error}
                  action={
                    <Button variant="outline" size="sm" onClick={list.reload}>
                      <RotateCwIcon aria-hidden data-icon="inline-start" />
                      Tentar de novo
                    </Button>
                  }
                />
              ) : (
                <SkeletonRows
                  rows={Math.min(pagination.pageSize, MAX_SKELETON_ROWS)}
                  columns={columns.length}
                />
              )
            ) : rows.length > 0 ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : narrowing.length > 0 ? (
              <TableMessageRow
                colSpan={columns.length}
                icon={<SearchXIcon aria-hidden />}
                title={empty.filtered}
                description="Revise a busca e os filtros, ou limpe-os para ver tudo."
                action={
                  <Button variant="outline" size="sm" onClick={clearNarrowing}>
                    <FunnelXIcon aria-hidden data-icon="inline-start" />
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <TableMessageRow
                colSpan={columns.length}
                icon={<InboxIcon aria-hidden />}
                title={empty.none}
              />
            )}
          </TableBody>
        </Table>
      </div>

      <nav
        aria-label={`Paginação: ${caption}`}
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <p aria-live="polite" className="text-muted-foreground">
          {response === null ? (
            list.error ? null : (
              "Carregando…"
            )
          ) : (
            <>
              {formatCount(response.total)} {response.total === 1 ? noun.one : noun.other} · página{" "}
              {formatCount(currentPage)} de {formatCount(pageCount)}
            </>
          )}
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
 * URL param, so a CPF is never applied (RF-617) and text ending in digits that may still become a
 * CPF, after a name or alone, waits for Enter (see `classifySearchText`).
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
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const kind = classifySearchText(draft);
  // Cancelled on unmount (the hook's default), on Enter, and by a value set from elsewhere.
  const debouncer = useDebouncer(onSearch, { wait: SEARCH_DEBOUNCE_MS });

  // The URL is the source of truth: a back/forward or a reset elsewhere refills the box.
  useEffect(() => {
    debouncer.cancel();
    setDraft(value);
  }, [value, debouncer]);

  // TanStack keeps this route mounted while the next route's loader runs, so a search left pending
  // could navigate back to the list after the user already clicked through to a detail page.
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", (event) => {
        if (event.pathChanged) debouncer.cancel();
      }),
    [router, debouncer],
  );

  function change(text: string) {
    setDraft(text);
    const next = classifySearchText(text);
    if (text.trim() === value || next === "cpf" || next === "digits") debouncer.cancel();
    else debouncer.maybeExecute(text);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    debouncer.cancel();
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
        onChange={(event) => change(event.target.value)}
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
    const thisYear = new Date().getFullYear();
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{filter.label}</Label>
        <DatePicker
          id={id}
          value={typeof value === "string" ? value : ""}
          onValueChange={(iso) => onChange(iso || undefined)}
          startMonth={new Date(thisYear - DATE_FILTER_YEARS_BACK, 0, 1)}
          endMonth={new Date(thisYear, 11, 1)}
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

/** Placeholder rows while the first page loads; hidden from assistive tech (the table is busy). */
function SkeletonRows({ rows, columns }: { rows: number; columns: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row} aria-hidden className="hover:bg-transparent">
      {Array.from({ length: columns }, (_, column) => (
        <TableCell key={column}>
          <Skeleton className={cn("h-4", column === 0 ? "w-32" : "w-20")} />
        </TableCell>
      ))}
    </TableRow>
  ));
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
