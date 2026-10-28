import Type, { type TSchema } from "typebox";

/**
 * The one list format every server-first table uses, API and browser alike (RFC D26).
 * Filters are top-level params from each endpoint's allow-list: `<field>` for equality,
 * `<field>From` / `<field>To` for ranges.
 */
export const LIST_DEFAULTS = { page: 1, pageSize: 20, maxPageSize: 100 } as const;

export const SORT_PATTERN = "^[A-Za-z][A-Za-z0-9]*:(asc|desc)$";

export const ListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_DEFAULTS.maxPageSize })),
    sort: Type.Optional(Type.String({ pattern: SORT_PATTERN })),
    q: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: Type.Union([Type.String(), Type.Number()]) },
);

/** URL/query state of a table: paging, sort, search and allow-listed filters. */
export type ListQuery = {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  [filter: string]: string | number | undefined;
};

export type ListResponse<Item> = {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function ListResponseSchema<Item extends TSchema>(item: Item) {
  return Type.Object({
    items: Type.Array(item),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  });
}
