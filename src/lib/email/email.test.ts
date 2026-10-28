import { describe, expect, it } from "vite-plus/test";

import { isEmail, normalizeEmail } from "./email";

describe("patient e-mail", () => {
  it("accepts common addresses however they are cased or padded", () => {
    for (const input of [
      "ana@exemplo.com",
      "Ana.Lima+clinica@Exemplo.com.br",
      " maria_souza@sub.dominio.org ",
      "o'neil@exemplo.co",
      "x@a-b.io",
    ]) {
      expect([input, isEmail(input)]).toEqual([input, true]);
    }
  });

  it("refuses anything that can't be delivered", () => {
    for (const input of [
      "",
      "ana",
      "ana@",
      "@exemplo.com",
      "ana@exemplo",
      "ana@exemplo.c",
      "ana@exemplo.123",
      "ana@@exemplo.com",
      "ana@exe@mplo.com",
      "ana lima@exemplo.com",
      ".ana@exemplo.com",
      "ana.@exemplo.com",
      "ana..lima@exemplo.com",
      "ana@-exemplo.com",
      "ana@exemplo-.com",
      "ana@exemplo..com",
      `${"a".repeat(65)}@exemplo.com`,
      `ana@${"a".repeat(250)}.com`,
    ]) {
      expect([input, isEmail(input)]).toEqual([input, false]);
    }
  });

  it("stores the trimmed, lower-cased address", () => {
    expect(normalizeEmail("  Ana.Lima@Exemplo.COM ")).toBe("ana.lima@exemplo.com");
  });
});
