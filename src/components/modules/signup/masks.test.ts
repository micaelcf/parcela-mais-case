import { describe, expect, it } from "vite-plus/test";

import { maskCep, maskCpf, maskMoney, maskPhone } from "./masks";

describe("signup masks", () => {
  it("formats a CPF progressively and idempotently", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("5299")).toBe("529.9");
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("52998224724")).toBe("529.982.247-24");
    expect(maskCpf("529.982.247-24")).toBe("529.982.247-24");
    expect(maskCpf("529.982.247-245")).toBe("529.982.247-24");
  });

  it("formats landline and mobile numbers", () => {
    expect(maskPhone("1")).toBe("(1");
    expect(maskPhone("119")).toBe("(11) 9");
    expect(maskPhone("1187654321")).toBe("(11) 8765-4321");
    expect(maskPhone("11987654321")).toBe("(11) 98765-4321");
    expect(maskPhone("(11) 98765-4321")).toBe("(11) 98765-4321");
  });

  it("drops a pasted country code or trunk prefix", () => {
    expect(maskPhone("+55 11 98765-4321")).toBe("(11) 98765-4321");
    expect(maskPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(maskPhone("011 98765-4321")).toBe("(11) 98765-4321");
    // Typing past 11 digits that start with 55 re-reads them as country code + number.
    expect(maskPhone("(55) 11987-654321")).toBe("(11) 98765-4321");
  });

  it("formats a CEP progressively and idempotently", () => {
    expect(maskCep("")).toBe("");
    expect(maskCep("01310")).toBe("01310");
    expect(maskCep("013101")).toBe("01310-1");
    expect(maskCep("01310100")).toBe("01310-100");
    expect(maskCep("01310-100")).toBe("01310-100");
    expect(maskCep("01310-1009")).toBe("01310-100");
    expect(maskCep("01.310-100")).toBe("01310-100");
  });

  it("groups an amount's thousands while typing, with at most two cents digits", () => {
    const typed = "1234567,891"
      .split("")
      .reduce<string[]>((shown, key) => [...shown, maskMoney(`${shown.at(-1) ?? ""}${key}`)], []);
    expect(typed).toEqual([
      "1",
      "12",
      "123",
      "1.234",
      "12.345",
      "123.456",
      "1.234.567",
      "1.234.567,",
      "1.234.567,8",
      "1.234.567,89",
      "1.234.567,89",
    ]);
  });

  it("keeps a pasted or tidied amount's value, dropping stray characters", () => {
    expect(maskMoney("R$ 10.000,00")).toBe("10.000,00");
    expect(maskMoney("10.000,00")).toBe("10.000,00");
    expect(maskMoney("10000")).toBe("10.000");
    expect(maskMoney(",5")).toBe("0,5");
    expect(maskMoney("007")).toBe("7");
    expect(maskMoney("5a0b0")).toBe("500");
    expect(maskMoney("")).toBe("");
  });
});
