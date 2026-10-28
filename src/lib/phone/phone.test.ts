import { Compile } from "typebox/compile";
import { describe, expect, it } from "vite-plus/test";

import { collectIssues } from "#/lib/validation/standard-schema";

import { normalizePhone, phoneIssue, PhoneSchema } from "./phone";

describe("Brazilian mobile phone", () => {
  it("accepts a mobile number however it is written", () => {
    for (const input of [
      "11987654321",
      "(11) 98765-4321",
      "11 98765 4321",
      "+55 11 98765-4321",
      "5511987654321",
      "011 98765-4321",
      "(91) 99123-4567",
      " (55) 99876-5432 ",
    ]) {
      expect([input, phoneIssue(input)]).toEqual([input, null]);
    }
  });

  it("stores the 11 national digits", () => {
    expect(normalizePhone("+55 (11) 98765-4321")).toBe("11987654321");
    expect(normalizePhone("011 98765-4321")).toBe("11987654321");
    // DDD 55 (Rio Grande do Sul) without a country code stays as is.
    expect(normalizePhone("(55) 99876-5432")).toBe("55998765432");
  });

  it("names what is wrong with anything else", () => {
    for (const [input, issue] of [
      // Area codes that don't exist.
      ["(00) 98765-4321", "AREA_CODE"],
      ["(10) 98765-4321", "AREA_CODE"],
      ["(20) 98765-4321", "AREA_CODE"],
      ["(23) 98765-4321", "AREA_CODE"],
      ["(52) 98765-4321", "AREA_CODE"],
      ["(90) 98765-4321", "AREA_CODE"],
      // A landline: 8 local digits starting with 2–5, with or without prefixes.
      ["(11) 3456-7890", "LANDLINE"],
      ["1125678901", "LANDLINE"],
      ["+55 (11) 3456-7890", "LANDLINE"],
      ["0 11 3456-7890", "LANDLINE"],
      // 11 digits whose local part doesn't start with 9, or 10 digits that aren't a landline.
      ["(11) 88765-4321", "NOT_MOBILE"],
      ["(11) 8765-4321", "NOT_MOBILE"],
      ["(11) 1234-5678", "NOT_MOBILE"],
      // Wrong length, another country or stray characters.
      ["98765-4321", "INVALID"],
      ["119876543210", "INVALID"],
      ["+1 415 555 0100", "INVALID"],
      ["11 9876a-4321", "INVALID"],
      ["", "INVALID"],
    ] as const) {
      expect([input, phoneIssue(input)]).toEqual([input, issue]);
    }
  });

  it("reports the matching pt-BR message", () => {
    const validator = Compile(PhoneSchema);
    const messageOf = (input: string) => collectIssues(PhoneSchema, input, validator)[0]?.message;
    expect(messageOf("(11) 98765-4321")).toBeUndefined();
    expect(messageOf("(00) 98765-4321")).toBe("DDD inválido");
    expect(messageOf("(11) 3456-7890")).toBe("Informe um celular; telefone fixo não é aceito");
    expect(messageOf("(11) 88765-4321")).toBe(
      "O celular deve ter 9 dígitos começando com 9 depois do DDD",
    );
    expect(messageOf("1234")).toBe("Informe o celular com DDD, ex.: (11) 98765-4321");
  });
});
