import { FieldApi, FormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vite-plus/test";

import { EMAIL_MESSAGE } from "#/lib/email/email";
import { collectIssues } from "#/lib/validation/standard-schema";

import {
  formFieldForRequestPath,
  SIGNUP_STEPS,
  SignupFormSchema,
  signupFormOptions,
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
  email: "",
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

  it("puts the optional e-mail on the contact step, after the phone", () => {
    expect(SIGNUP_STEPS[1].fields).toEqual(["phone", "email"]);
  });

  it("accepts a blank e-mail and checks a typed one with the shared message", () => {
    expect(messagesFor({ ...VALUES, email: "" }, "email")).toEqual([]);
    expect(messagesFor({ ...VALUES, email: "   " }, "email")).toEqual([]);
    expect(messagesFor({ ...VALUES, email: " Ana@Clinica.com.br " }, "email")).toEqual([]);
    expect(messagesFor({ ...VALUES, email: "ana@clinica" }, "email")).toEqual([EMAIL_MESSAGE]);
  });

  it("sends the e-mail normalised", () => {
    const body = toSignupRequest({ ...VALUES, email: " Ana@Clinica.COM " }, false);
    expect(body.email).toBe("ana@clinica.com");
  });

  it("omits a blank e-mail from the request", () => {
    expect(toSignupRequest({ ...VALUES, email: "" }, false)).not.toHaveProperty("email");
    expect(toSignupRequest({ ...VALUES, email: "  " }, false)).not.toHaveProperty("email");
  });

  it("maps the API's e-mail error to the e-mail field", () => {
    expect(formFieldForRequestPath("email")).toBe("email");
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
      email: "ana@",
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
      "email",
      "monthlyIncome",
      "treatmentAmount",
    ]);
    expect(signupValidator["~standard"].validate(VALUES)).toEqual({ value: VALUES });
  });
});

/** A mounted signup form (its real options) with `name` mounted as a field. */
function mountedField(name: "cpf" | "fullName") {
  const form = new FormApi(signupFormOptions);
  form.mount();
  const field = new FieldApi({ form, name });
  field.mount();
  return { form, field };
}

function errorMessages(field: { state: { meta: { errors: unknown[] } } }): string[] {
  return field.state.meta.errors.flatMap((error) =>
    typeof error === "object" && error !== null && "message" in error
      ? [String(error.message)]
      : [],
  );
}

describe("signup form validation timing", () => {
  it("doesn't validate while typing", () => {
    const { field } = mountedField("cpf");
    field.handleChange("529.982");
    expect(field.state.meta.errors).toEqual([]);
  });

  it("validates when the field loses focus", () => {
    const { field } = mountedField("cpf");
    field.handleChange("529.982");
    field.handleBlur();
    expect(errorMessages(field)).toEqual(["CPF inválido"]);
  });

  it("keeps the error while typing until the next blur", () => {
    const { field } = mountedField("cpf");
    field.handleChange("529.982");
    field.handleBlur();
    field.handleChange("529.982.247-25");
    expect(errorMessages(field)).toEqual(["CPF inválido"]);
    field.handleBlur();
    expect(field.state.meta.errors).toEqual([]);
  });

  it("validates every field on submit", async () => {
    const { form, field } = mountedField("fullName");
    await form.handleSubmit();
    expect(errorMessages(field)).toEqual(["Informe nome e sobrenome"]);
    expect(form.state.canSubmit).toBe(false);
  });
});
