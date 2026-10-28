import Type from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { toStandardSchema } from "./standard-schema";

const Signup = Type.Object({
  fullName: Type.String({ minLength: 3 }),
  cpf: Type.Refine(
    Type.String(),
    (value) => value === "52998224725",
    () => "CPF inválido",
  ),
  age: Type.Integer({ minimum: 18, error: "Idade fora do permitido" }),
});

function validate(value: unknown) {
  const result = toStandardSchema(Signup)["~standard"].validate(value);
  return result.issues ?? [];
}

describe("toStandardSchema", () => {
  it("puts a refine failure on its field path", () => {
    const issues = validate({ fullName: "Maria Silva", cpf: "52998224724", age: 30 });

    expect(issues).toEqual([{ path: ["cpf"], message: "CPF inválido" }]);
  });

  it("re-homes required errors to the missing property", () => {
    const issues = validate({ cpf: "52998224725", age: 30 });

    expect(issues).toEqual([{ path: ["fullName"], message: "Campo obrigatório" }]);
  });

  it("prefers a node's error annotation over the keyword message", () => {
    const issues = validate({ fullName: "Maria Silva", cpf: "52998224725", age: 17 });

    expect(issues).toEqual([{ path: ["age"], message: "Idade fora do permitido" }]);
  });

  it("coerces env-style strings and applies defaults when asked", () => {
    const Port = Type.Object({ port: Type.Integer({ default: 3000 }), on: Type.Boolean() });
    const result = toStandardSchema(Port, { coerce: true })["~standard"].validate({ on: "true" });

    expect(result).toEqual({ value: { port: 3000, on: true } });
  });
});
