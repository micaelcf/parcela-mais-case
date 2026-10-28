import { describe, expect, it } from "vite-plus/test";

import { collectIssues } from "#/lib/validation/standard-schema";

import {
  formFieldForRequestPath,
  SIGNUP_STEPS,
  SignupFormSchema,
  type SignupFormValues,
  signupValidator,
  toSignupRequest,
} from "./signup-form";

const VALUES: SignupFormValues = {
  fullName: "  Lucia Teste  ",
  cpf: "529.982.247-25",
  birthdate: "1986-05-17",
  cep: "01310-100",
  street: " Avenida Paulista ",
  addressNumber: " 1578 ",
  complement: "  ",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  phone: "(11) 98765-4321",
  monthlyIncome: "5.000,00",
  treatmentAmount: "10.000,00",
  simulationScenario: "ALL_APPROVE",
};

function messagesFor(values: SignupFormValues, field: keyof SignupFormValues): string[] {
  return collectIssues(SignupFormSchema, values)
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("signup form", () => {
  it("shows the address in step 1 right after the birthdate", () => {
    expect(SIGNUP_STEPS[0].fields).toEqual([
      "fullName",
      "cpf",
      "birthdate",
      "cep",
      "street",
      "addressNumber",
      "complement",
      "neighborhood",
      "city",
      "state",
    ]);
  });

  it("builds the nested address, dropping a blank complement", () => {
    const body = toSignupRequest(VALUES, true);
    expect(body.address).toEqual({
      cep: "01310100",
      street: "Avenida Paulista",
      number: "1578",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(body.fullName).toBe("Lucia Teste");
    expect(body.simulationScenario).toBe("ALL_APPROVE");
  });

  it("keeps a typed complement", () => {
    const body = toSignupRequest({ ...VALUES, complement: " apto 12 " }, false);
    expect(body.address.complement).toBe("apto 12");
    expect(body).not.toHaveProperty("simulationScenario");
  });

  it("maps the API's address error paths to the flat form fields", () => {
    expect(formFieldForRequestPath("address.cep")).toBe("cep");
    expect(formFieldForRequestPath("address.street")).toBe("street");
    expect(formFieldForRequestPath("address.number")).toBe("addressNumber");
    expect(formFieldForRequestPath("address.complement")).toBe("complement");
    expect(formFieldForRequestPath("address.neighborhood")).toBe("neighborhood");
    expect(formFieldForRequestPath("address.city")).toBe("city");
    expect(formFieldForRequestPath("address.state")).toBe("state");
    expect(formFieldForRequestPath("monthlyIncomeCents")).toBe("monthlyIncome");
    expect(formFieldForRequestPath("address")).toBeUndefined();
  });

  it("checks the address fields with the API's messages", () => {
    expect(collectIssues(SignupFormSchema, VALUES)).toEqual([]);
    const blank = {
      ...VALUES,
      cep: "01310-10",
      street: " ",
      addressNumber: "",
      neighborhood: "",
      city: "",
      state: "",
    };
    expect(messagesFor(blank, "cep")).toEqual(["CEP inválido"]);
    expect(messagesFor(blank, "street")).toEqual(["Informe a rua"]);
    expect(messagesFor(blank, "addressNumber")).toEqual(["Informe o número (ou S/N)"]);
    expect(messagesFor(blank, "neighborhood")).toEqual(["Informe o bairro"]);
    expect(messagesFor(blank, "city")).toEqual(["Informe a cidade"]);
    expect(messagesFor(blank, "state")).toEqual(["Selecione a UF"]);
    expect(messagesFor({ ...VALUES, state: "XX" }, "state")).toEqual(["Selecione a UF"]);
    expect(messagesFor({ ...VALUES, addressNumber: "S/N" }, "addressNumber")).toEqual([]);
  });

  it("reports every invalid field at once, past TypeBox's error cap", () => {
    const empty: SignupFormValues = {
      fullName: "",
      cpf: "",
      birthdate: "",
      cep: "",
      street: "",
      addressNumber: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
      phone: "",
      monthlyIncome: "",
      treatmentAmount: "999,99",
      simulationScenario: "NORMAL",
    };
    const result = signupValidator["~standard"].validate(empty);
    expect(result.issues?.map((issue) => issue.path[0])).toEqual([
      "fullName",
      "cpf",
      "birthdate",
      "cep",
      "street",
      "addressNumber",
      "neighborhood",
      "city",
      "state",
      "phone",
      "monthlyIncome",
      "treatmentAmount",
    ]);
    expect(signupValidator["~standard"].validate(VALUES)).toEqual({ value: VALUES });
  });
});
