import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import type { StandardResult } from "#/lib/validation/standard-schema";

import {
  ConsultationSearchSchema,
  listSearchValidator,
  SwitchLogSearchSchema,
  toListQuery,
} from "./table-search";

const consultations = listSearchValidator(ConsultationSearchSchema)["~standard"];
const switchLog = listSearchValidator(SwitchLogSearchSchema)["~standard"];

/** What the router does on a reload and on the next navigation: URL → validated search → URL. */
function throughUrl<T extends object>(
  validate: (value: unknown) => StandardResult<T>,
  search: object,
) {
  const result = validate(defaultParseSearch(defaultStringifySearch(search)));
  if (result.issues) throw new Error("search validation failed");
  return { value: result.value, url: defaultStringifySearch(result.value) };
}

describe("backoffice table search params (RF-617)", () => {
  it("keeps table state in search params without the CPF", () => {
    const state = {
      page: 3,
      pageSize: 50,
      sort: "treatmentAmountCents:asc",
      q: "Maria",
      status: "OFFERS",
      simulationScenario: "DELTA_FAILS",
      createdAtFrom: "2026-10-01",
      createdAtTo: "2026-10-28",
      treatmentAmountCentsFrom: 100000,
    };

    const { url, value } = throughUrl(consultations.validate, { ...state, cpf: "52998224725" });

    expect(value).toEqual(state);
    expect(url).not.toContain("cpf");
    expect(url).not.toContain("52998224725");
    expect(throughUrl(consultations.validate, value).value).toEqual(state);

    // A numeric-looking search term stays the same text after the round trip.
    expect(throughUrl(consultations.validate, { q: "1234" }).value).toEqual({ q: "1234" });

    // Booleans survive the URL and reach the API as the text the allow-list parses.
    const log = throughUrl(switchLog.validate, { lender: "DELTA", enabled: false });
    expect(log.value).toEqual({ lender: "DELTA", enabled: false });
    expect(toListQuery(log.value)).toEqual({ lender: "DELTA", enabled: "false" });
  });

  it("drops a CPF and any key outside the allow-list from a hand-typed URL", () => {
    const result = consultations.validate(
      defaultParseSearch("?cpf=52998224725&page=2&sort=createdAt:desc&patientName=Ana"),
    );
    expect(result).toEqual({ value: { page: 2, sort: "createdAt:desc" } });
  });

  it("drops values that don't fit instead of failing the page", () => {
    const result = consultations.validate(
      defaultParseSearch("?page=0&pageSize=500&sort=cpf:asc&status=PAID&q=Ana"),
    );
    expect(result).toEqual({ value: { q: "Ana" } });
  });

  it("turns calendar-day bounds into instants covering the whole local day", () => {
    const query = toListQuery({ createdAtFrom: "2026-10-01", createdAtTo: "2026-10-28", page: 2 });
    expect(query).toEqual({
      createdAtFrom: new Date("2026-10-01T00:00:00").toISOString(),
      createdAtTo: new Date("2026-10-28T23:59:59.999").toISOString(),
      page: 2,
    });
  });
});
