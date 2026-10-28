import { createFormHook } from "@tanstack/react-form";
import Type, { type Static, type TSchema } from "typebox";
import { Compile } from "typebox/compile";

import { normalizeCpf } from "#/lib/cpf/cpf";
import { parseCentsInput } from "#/lib/money/money";
import { normalizePhone } from "#/lib/phone/phone";
import {
  collectIssues,
  type StandardSchemaV1,
  toStandardSchema,
} from "#/lib/validation/standard-schema";
import {
  ScenarioSchema,
  type SignupRequest,
  SignupRequestSchema,
} from "#/server/modules/consultation/consultation.dto";

import { fieldContext, formContext } from "./form-context";
import { MoneyField, ScenarioField, TextField } from "./SignupFields";

const request = SignupRequestSchema.properties;

/** A currency input (raw text) checked by the API's cents schema, with that schema's message. */
function centsInput(schema: TSchema) {
  const validator = Compile(schema);
  const issue = (raw: string) => collectIssues(schema, parseCentsInput(raw), validator)[0]?.message;
  return Type.Refine(
    Type.String(),
    (raw) => issue(raw) === undefined,
    (raw) => issue(raw) ?? "Valor inválido",
  );
}

/**
 * What the form holds: the inputs as typed (masks included), checked by the API's own field schemas.
 * Money fields stay text until the request is built.
 */
export const SignupFormSchema = Type.Object({
  fullName: request.fullName,
  cpf: request.cpf,
  birthdate: request.birthdate,
  phone: request.phone,
  monthlyIncome: centsInput(request.monthlyIncomeCents),
  treatmentAmount: centsInput(request.treatmentAmountCents),
  simulationScenario: ScenarioSchema,
});
export type SignupFormValues = Static<typeof SignupFormSchema>;
export type SignupFieldName = keyof SignupFormValues;

const DEFAULT_VALUES: SignupFormValues = {
  fullName: "",
  cpf: "",
  birthdate: "",
  phone: "",
  monthlyIncome: "",
  treatmentAmount: "",
  simulationScenario: "NORMAL",
};

/**
 * `toStandardSchema` declares its input as `unknown`; TanStack Form wants the form's value type
 * there. Same `validate`, re-declared over the form values (the `types` hint is inference-only).
 */
const signupValidator: StandardSchemaV1<SignupFormValues, SignupFormValues> = {
  "~standard": { ...toStandardSchema(SignupFormSchema)["~standard"], types: undefined },
};

/** The three steps, in order, and the fields each one owns. */
export const SIGNUP_STEPS = [
  {
    to: "/cadastro/paciente",
    title: "Paciente",
    fields: ["fullName", "cpf", "birthdate"],
  },
  { to: "/cadastro/contato", title: "Contato", fields: ["phone"] },
  {
    to: "/cadastro/financeiro",
    title: "Financeiro",
    fields: ["monthlyIncome", "treatmentAmount", "simulationScenario"],
  },
] as const satisfies ReadonlyArray<{
  to: string;
  title: string;
  fields: readonly SignupFieldName[];
}>;

/** Every field in on-screen order (step by step): the order "first invalid field" follows. */
export const SIGNUP_FIELD_ORDER: readonly SignupFieldName[] = SIGNUP_STEPS.flatMap(
  (step) => step.fields,
);

/** The index of the step that shows `name`. */
export function stepOfField(name: SignupFieldName): number {
  return SIGNUP_STEPS.findIndex((step) => step.fields.some((field) => field === name));
}

/** Request property (as the API reports it in 422 `fields[].path`) → the form field holding it. */
const REQUEST_FIELD: Record<keyof SignupRequest, SignupFieldName> = {
  fullName: "fullName",
  cpf: "cpf",
  birthdate: "birthdate",
  phone: "phone",
  monthlyIncomeCents: "monthlyIncome",
  treatmentAmountCents: "treatmentAmount",
  simulationScenario: "simulationScenario",
};

export function formFieldForRequestPath(path: string): SignupFieldName | undefined {
  return Object.entries(REQUEST_FIELD).find(([key]) => key === path)?.[1];
}

function cents(raw: string): number {
  const value = parseCentsInput(raw);
  if (value === null) throw new Error("A validated currency field didn't parse");
  return value;
}

/** Validated form values → the API body. The scenario goes only when simulation controls are on. */
export function toSignupRequest(
  values: SignupFormValues,
  simulationControls: boolean,
): SignupRequest {
  return {
    fullName: values.fullName.trim(),
    cpf: normalizeCpf(values.cpf),
    birthdate: values.birthdate,
    phone: normalizePhone(values.phone),
    monthlyIncomeCents: cents(values.monthlyIncome),
    treatmentAmountCents: cents(values.treatmentAmount),
    ...(simulationControls ? { simulationScenario: values.simulationScenario } : {}),
  };
}

const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, MoneyField, ScenarioField },
  formComponents: {},
});

/** The single signup form instance (owned by the `/cadastro` layout). */
export function useSignupForm(handlers: {
  onSubmit: (values: SignupFormValues) => Promise<void>;
  onSubmitInvalid: () => void;
}) {
  return useAppForm({
    defaultValues: DEFAULT_VALUES,
    validators: { onChange: signupValidator, onSubmit: signupValidator },
    onSubmit: ({ value }) => handlers.onSubmit(value),
    onSubmitInvalid: () => handlers.onSubmitInvalid(),
  });
}
export type SignupForm = ReturnType<typeof useSignupForm>;
