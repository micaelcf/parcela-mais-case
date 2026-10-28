import Type, { type Static, type TSchema } from "typebox";

/**
 * The one list format every server-first table uses, API and browser alike (RFC D26).
 * Filters are top-level params from each endpoint's allow-list: `<field>` for equality,
 * `<field>From` / `<field>To` for ranges. The schemas are the source; the types derive from them.
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
export type ListQuery = Static<typeof ListQuerySchema>;

/** Paging metadata every list response carries next to its `items`. */
export const ListPageSchema = Type.Object({
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1 }),
  total: Type.Integer({ minimum: 0 }),
  totalPages: Type.Integer({ minimum: 0 }),
});

export function ListResponseSchema<Item extends TSchema>(item: Item) {
  return Type.Object({ items: Type.Array(item), ...ListPageSchema.properties });
}

export type ListResponse<Item> = Static<typeof ListPageSchema> & { items: Item[] };
