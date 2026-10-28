import { describe, expect, it } from "vite-plus/test";

import { LENDER_CODES } from "#/lib/enums";
import { DomainError } from "#/server/lib/errors/domain-error";
import { lenderSwitchLog } from "#/server/modules/lender/db/lender-switch-log.table";

import { type ListSpec, parseFilter, parseListQuery } from "./list-query";

const spec: ListSpec = {
  filters: {
    lender: { column: lenderSwitchLog.lender, kind: "eq", parse: parseFilter.oneOf(LENDER_CODES) },
    createdAt: { column: lenderSwitchLog.createdAt, kind: "range", parse: parseFilter.instant() },
  },
  sorts: { createdAt: lenderSwitchLog.createdAt, lender: lenderSwitchLog.lender },
  search: [lenderSwitchLog.actor],
  defaultSort: "createdAt:desc",
  tiebreaker: lenderSwitchLog.id,
};

function validationPaths(raw: Record<string, unknown>): string[] {
  try {
    parseListQuery(raw, spec);
  } catch (error) {
    if (error instanceof DomainError && error.code === "VALIDATION") {
      return (error.fields ?? []).map((field) => field.path);
    }
    throw error;
  }
  return [];
}

describe("parseListQuery", () => {
  it("rejects fields outside the allow-list", () => {
    expect(validationPaths({ sort: "cpf:asc" })).toEqual(["sort"]);
    expect(validationPaths({ cpf: "52998224725" })).toEqual(["cpf"]);
    expect(validationPaths({ actor: "operador" })).toEqual(["actor"]);
    expect(validationPaths({ lenderFrom: "ALFA" })).toEqual(["lenderFrom"]);
  });

  it("applies page bounds and defaults", () => {
    expect(parseListQuery({}, spec)).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: { field: "createdAt", direction: "desc" },
      filters: [],
    });
    expect(validationPaths({ page: "0" })).toEqual(["page"]);
    expect(validationPaths({ pageSize: "0" })).toEqual(["pageSize"]);
    expect(validationPaths({ pageSize: "101" })).toEqual(["pageSize"]);
    expect(parseListQuery({ page: "3", pageSize: "100" }, spec)).toMatchObject({
      page: 3,
      pageSize: 100,
    });
  });

  it("accepts allow-listed equality and range filters with typed values", () => {
    const parsed = parseListQuery(
      { lender: "DELTA", createdAtFrom: "2026-10-01", createdAtTo: "2026-10-31T23:59:59Z" },
      spec,
    );

    expect(parsed.filters.map((filter) => filter.op)).toEqual(["eq", "gte", "lte"]);
    expect(validationPaths({ lender: "OMEGA" })).toEqual(["lender"]);
    expect(validationPaths({ createdAtFrom: "ontem" })).toEqual(["createdAtFrom"]);
  });
});
