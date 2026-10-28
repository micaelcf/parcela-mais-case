import { describe, expect, it } from "vite-plus/test";

import { divRoundHalfUp, priceInstallment } from "./price";

type Row = {
  principalCents: number;
  monthlyRate: string;
  termMonths: number;
  installmentCents: number;
  totalCents: number;
};

/** `[term, installment, total]` per lender rate, per principal (slice S2 reference table). */
const REFERENCE: Record<
  number,
  Record<string, ReadonlyArray<readonly [number, number, number]>>
> = {
  1_000_000: {
    "0.024900": [
      [6, 181489, 1088934],
      [12, 97428, 1169136],
      [18, 69610, 1252980],
    ],
    "0.019900": [
      [12, 94502, 1134024],
      [18, 66643, 1199574],
      [24, 52811, 1267464],
    ],
    "0.032900": [
      [6, 186376, 1118256],
      [10, 118972, 1189720],
      [12, 102209, 1226508],
    ],
    "0.021900": [
      [12, 95666, 1147992],
      [24, 54016, 1296384],
      [36, 40440, 1455840],
    ],
  },
  100_000: {
    "0.024900": [
      [6, 18149, 108894],
      [12, 9743, 116916],
      [18, 6961, 125298],
    ],
    "0.019900": [
      [12, 9450, 113400],
      [18, 6664, 119952],
      [24, 5281, 126744],
    ],
    "0.032900": [
      [6, 18638, 111828],
      [10, 11897, 118970],
      [12, 10221, 122652],
    ],
    "0.021900": [
      [12, 9567, 114804],
      [24, 5402, 129648],
      [36, 4044, 145584],
    ],
  },
  5_000_000: {
    "0.024900": [
      [6, 907446, 5444676],
      [12, 487141, 5845692],
      [18, 348050, 6264900],
    ],
    "0.019900": [
      [12, 472508, 5670096],
      [18, 333217, 5997906],
      [24, 264056, 6337344],
    ],
    "0.032900": [
      [6, 931879, 5591274],
      [10, 594860, 5948600],
      [12, 511045, 6132540],
    ],
    "0.021900": [
      [12, 478332, 5739984],
      [24, 270079, 6481896],
      [36, 202200, 7279200],
    ],
  },
};

const ROWS: Row[] = Object.entries(REFERENCE).flatMap(([principal, byRate]) =>
  Object.entries(byRate).flatMap(([monthlyRate, cells]) =>
    cells.map(([termMonths, installmentCents, totalCents]) => ({
      principalCents: Number(principal),
      monthlyRate,
      termMonths,
      installmentCents,
      totalCents,
    })),
  ),
);

describe("Tabela Price", () => {
  it("matches the PDF formula for 10.000 reais at 2,49% in 12x", () => {
    expect(
      priceInstallment({ principalCents: 1_000_000, monthlyRate: "0.024900", termMonths: 12 }),
    ).toEqual({ installmentCents: 97428, totalCents: 1169136 });
  });

  it("matches the reference table for every lender rate and term", () => {
    expect(ROWS).toHaveLength(36);
    for (const row of ROWS) {
      const { principalCents, monthlyRate, termMonths } = row;
      expect(
        priceInstallment({ principalCents, monthlyRate, termMonths }),
        `${principalCents} @ ${monthlyRate} × ${termMonths}`,
      ).toEqual({ installmentCents: row.installmentCents, totalCents: row.totalCents });
    }
  });

  it("total equals installment times term", () => {
    for (const row of ROWS) {
      const { principalCents, monthlyRate, termMonths } = row;
      const result = priceInstallment({ principalCents, monthlyRate, termMonths });
      expect(result.totalCents).toBe(result.installmentCents * termMonths);
      expect(row.totalCents).toBe(row.installmentCents * termMonths);
    }
  });

  it("rounds half up", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(7n, 2n)).toBe(4n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(5n, 3n)).toBe(2n);
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });
});
