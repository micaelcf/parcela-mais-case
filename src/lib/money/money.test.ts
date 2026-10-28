import { describe, expect, it } from "vite-plus/test";

import { formatBRL, formatCentsInput, formatRate, parseCentsInput } from "./money";

describe("money", () => {
  it("formats cents and monthly rates in pt-BR", () => {
    expect(formatBRL(97428)).toBe("R$ 974,28");
    expect(formatBRL(1169136)).toBe("R$ 11.691,36");
    expect(formatRate("0.024900")).toBe("2,49% a.m.");
    expect(formatRate("0.019900")).toBe("1,99% a.m.");
    expect(formatRate("0.032900")).toBe("3,29% a.m.");
  });

  it("parses what the user types in a currency input into cents", () => {
    expect(parseCentsInput("R$ 10.000,00")).toBe(1_000_000);
    expect(parseCentsInput("999,99")).toBe(99_999);
    expect(parseCentsInput("50.000,01")).toBe(5_000_001);
    expect(parseCentsInput("1000")).toBe(100_000);
    expect(parseCentsInput("1000,5")).toBe(100_050);
    expect(parseCentsInput("")).toBeNull();
    expect(parseCentsInput("10,000.00")).toBeNull();
    expect(parseCentsInput("abc")).toBeNull();
  });

  it("formats cents for a currency input", () => {
    expect(formatCentsInput(1_000_000)).toBe("10.000,00");
    expect(parseCentsInput(formatCentsInput(5_000_001))).toBe(5_000_001);
  });
});
