import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import type { StandardResult } from "#/lib/validation/standard-schema";

import {
  classifySearchText,
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

  it("keeps a CPF typed in the search box out of the URL", () => {
    // A CPF, formatted or not, alone or next to a name: never applied; the box points to
    // "Buscar por CPF" instead.
    for (const text of [
      "52998224725",
      "529.982.247-25",
      " 529 982 247 25 ",
      "529982247-25",
      "Ana 52998224725",
      "Ana 529.982.247-25",
      // One digit too many is still a CPF on its way to the URL.
      "529982247251",
      // Dash-separated digits are no consultation id without a hex letter.
      "529-982-247-25",
      // An id prefix hiding a CPF in its last group is still refused.
      "019a2b3c-0000-7000-8000-52998224725",
    ]) {
      expect([text, classifySearchText(text)]).toEqual([text, "cpf"]);
    }
    // Text ending in digits that may still become a CPF, whatever words come before them: applied
    // on Enter only, never by the typing pause, so "Ana 5299822" never reaches the URL on its own.
    for (const text of [
      "5",
      "529.982",
      "529982247",
      "0193",
      "Ana 5299822",
      "Ana 529.982",
      "Ana 1234",
    ]) {
      expect([text, classifySearchText(text)]).toEqual([text, "digits"]);
    }
    // Names, ids and anything else not ending in digits search as usual (a consultation id is a
    // UUID: plain text whole or as a prefix past its first group, though later groups may be all
    // digits).
    for (const text of [
      "Maria",
      "019a2b3c-0000-7000-8000-000000000000",
      "019A2B3C-0000-7000-8000-000000000000",
      "019a2b3c-1234-7123-8123",
      "019a2b3c-1234",
      "1234 Ana",
    ]) {
      expect([text, classifySearchText(text)]).toEqual([text, "text"]);
    }
    expect(classifySearchText("   ")).toBe("empty");
  });
});
