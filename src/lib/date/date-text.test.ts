import { describe, expect, it } from "vite-plus/test";

import {
  dateFromIso,
  dateTextFromIso,
  isoFromDate,
  isoFromDateText,
  maskDateText,
} from "./date-text";

describe("date text", () => {
  it("masks typed digits as dd/mm/aaaa progressively and idempotently", () => {
    expect(maskDateText("")).toBe("");
    expect(maskDateText("1")).toBe("1");
    expect(maskDateText("17")).toBe("17");
    expect(maskDateText("170")).toBe("17/0");
    expect(maskDateText("1705")).toBe("17/05");
    expect(maskDateText("17051")).toBe("17/05/1");
    expect(maskDateText("17051990")).toBe("17/05/1990");
    expect(maskDateText("17/05/1990")).toBe("17/05/1990");
    expect(maskDateText("17/05/19901")).toBe("17/05/1990");
    expect(maskDateText("17-05-1990")).toBe("17/05/1990");
  });

  it("reads a complete real date as ISO", () => {
    expect(isoFromDateText("17/05/1990")).toBe("1990-05-17");
    expect(isoFromDateText("29/02/2024")).toBe("2024-02-29");
    expect(isoFromDateText("01/01/1946")).toBe("1946-01-01");
  });

  it("rejects incomplete and impossible dates", () => {
    expect(isoFromDateText("")).toBeNull();
    expect(isoFromDateText("17/05")).toBeNull();
    expect(isoFromDateText("17/05/199")).toBeNull();
    expect(isoFromDateText("31/02/1990")).toBeNull();
    expect(isoFromDateText("29/02/2023")).toBeNull();
    expect(isoFromDateText("00/05/1990")).toBeNull();
    expect(isoFromDateText("17/13/1990")).toBeNull();
    expect(isoFromDateText("17/05/0000")).toBeNull();
  });

  it("shows an ISO date as dd/mm/aaaa", () => {
    expect(dateTextFromIso("1990-05-17")).toBe("17/05/1990");
    expect(dateTextFromIso("")).toBe("");
    expect(dateTextFromIso("1990-02-31")).toBe("");
  });

  it("converts between ISO and a local calendar date", () => {
    const date = dateFromIso("1990-05-17");
    expect(date?.getFullYear()).toBe(1990);
    expect(date?.getMonth()).toBe(4);
    expect(date?.getDate()).toBe(17);
    expect(dateFromIso("")).toBeUndefined();
    expect(dateFromIso("1990-02-31")).toBeUndefined();
    expect(isoFromDate(new Date(1990, 4, 17, 23, 59))).toBe("1990-05-17");
    expect(isoFromDate(new Date(2024, 0, 5))).toBe("2024-01-05");
  });
});
