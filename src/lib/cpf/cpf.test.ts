import { Compile } from "typebox/compile";
import { describe, expect, it } from "vite-plus/test";

import { CpfSchema, cpfCheckDigits, isValidCpf, normalizeCpf } from "./cpf";

/** Independently known valid CPFs, formatted. */
const VALID_FORMATTED = [
  "529.982.247-25",
  "111.444.777-35",
  "123.456.789-09",
  "935.411.347-80",
  "453.178.287-91",
  "390.533.447-05",
];

describe("CPF validation", () => {
  it("accepts valid CPFs formatted and unformatted", () => {
    const fromBase = `987654321${cpfCheckDigits("987654321")}`;
    const valid = [...VALID_FORMATTED, ...VALID_FORMATTED.map(normalizeCpf), fromBase];

    expect(new Set(VALID_FORMATTED.map(normalizeCpf)).size).toBeGreaterThanOrEqual(5);
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    for (const cpf of valid) expect(isValidCpf(cpf), cpf).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidCpf("529.982.247-15")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("52998224715")).toBe(false);
    expect(isValidCpf("52998224724")).toBe(false);
  });

  it("rejects repeated-digit CPFs", () => {
    for (let digit = 0; digit <= 9; digit++) {
      const d = String(digit);
      const formatted = `${d.repeat(3)}.${d.repeat(3)}.${d.repeat(3)}-${d.repeat(2)}`;
      expect(isValidCpf(formatted), formatted).toBe(false);
      expect(isValidCpf(d.repeat(11)), d.repeat(11)).toBe(false);
    }
  });

  it("rejects wrong lengths and non-digits", () => {
    const invalid = [
      "5299822472", // 10 digits
      "529982247250", // 12 digits
      "",
      "529982247a25", // letter replacing a digit
      "5299a82247-25", // letter mixed into 11 digits
      "52998224725x",
      "x52998224725",
      "529.982.24a-25",
    ];
    for (const cpf of invalid) expect(isValidCpf(cpf), JSON.stringify(cpf)).toBe(false);
  });

  it("CpfSchema rejects invalid check digits with a pt-BR message", () => {
    const validator = Compile(CpfSchema);

    expect(validator.Check("529.982.247-24")).toBe(false);
    const messages = [...validator.Errors("529.982.247-24")].map((error) => error.message);
    expect(messages).toContain("CPF inválido");

    expect(validator.Check("529.982.247-25")).toBe(true);
    expect([...validator.Errors("529.982.247-25")]).toEqual([]);
  });
});
