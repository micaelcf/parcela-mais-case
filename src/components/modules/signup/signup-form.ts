import { createFormHook, formOptions } from "@tanstack/react-form";
import Type, { type Static, type TSchema } from "typebox";
import { Compile } from "typebox/compile";

import {
  type Address,
  AddressSchema,
  BR_STATES,
  type BrState,
  normalizeAddress,
} from "#/lib/address/address";
import { normalizeCpf } from "#/lib/cpf/cpf";
import { EmailSchema, normalizeEmail } from "#/lib/email/email";
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
import {
  CepField,
  DateField,
  MoneyField,
  ScenarioField,
  StateField,
  TextField,
} from "./SignupFields";

const request = SignupRequestSchema.properties;
const address = AddressSchema.properties;

/**
 * A text input checked by an API schema against what `parse` reads from it, with that schema's
 * message (a currency input against the cents schema, a UF against the state enum). An `optional`
 * one passes while blank.
 */
function checkedText(
  schema: TSchema,
  { parse = (raw: string): unknown => raw, optional = false } = {},
) {
  const validator = Compile(schema);
  const issue = (raw: string) =>
    optional && raw.trim() === ""
      ? undefined
      : collectIssues(schema, parse(raw), validator)[0]?.message;
  return Type.Refine(
    Type.String(),
    (raw) => issue(raw) === undefined,
    (raw) => issue(raw) ?? "Valor inválido",
  );
}

/**
 * What the form holds: the inputs as typed (masks included), checked by the API's own field schemas.
 * Money fields stay text until the request is built; the address is flat here, nested in the body.
 */
export const SignupFormSchema = Type.Object({
  fullName: request.fullName,
  cpf: request.cpf,
  birthdate: request.birthdate,
  cep: address.cep,
  street: address.street,
  addressNumber: address.number,
  complement: address.complement,
  neighborhood: address.neighborhood,
  city: address.city,
  state: checkedText(address.state),
  phone: request.phone,
  email: checkedText(EmailSchema, { optional: true }),
  monthlyIncome: checkedText(request.monthlyIncomeCents, { parse: parseCentsInput }),
  treatmentAmount: checkedText(request.treatmentAmountCents, { parse: parseCentsInput }),
  simulationScenario: ScenarioSchema,
});
export type SignupFormValues = Static<typeof SignupFormSchema>;
export type SignupFieldName = keyof SignupFormValues;

const DEFAULT_VALUES: SignupFormValues = {
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
  email: "",
  monthlyIncome: "",
  treatmentAmount: "",
  simulationScenario: "NORMAL",
};

/**
 * The form's validator. `toStandardSchema` declares its input as `unknown`; TanStack Form wants the
 * form's value type there, so it's re-declared over the form values (the `types` hint is
 * inference-only).
 */
export const signupValidator: StandardSchemaV1<SignupFormValues, SignupFormValues> = {
  "~standard": { ...toStandardSchema(SignupFormSchema)["~standard"], types: undefined },
};

/** The steps, in order, and the fields each one owns; the last one, the review, owns none. */
export const SIGNUP_STEPS = [
  {
    to: "/cadastro/paciente",
    title: "Paciente",
    fields: [
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
    ],
  },
  { to: "/cadastro/contato", title: "Contato", fields: ["phone", "email"] },
  {
    to: "/cadastro/financeiro",
    title: "Financeiro",
    fields: ["monthlyIncome", "treatmentAmount", "simulationScenario"],
  },
  { to: "/cadastro/revisao", title: "Revisão", fields: [] },
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

const formCheck = Compile(SignupFormSchema);
const CEP_STEP = stepOfField("cep");

/**
 * Whether each step is complete: its fields pass validation and, for the CEP's step, the lookup has
 * answered so the address shows. The review, owning no field, always is.
 */
export function completedSteps(values: SignupFormValues, addressShown: boolean): boolean[] {
  const invalid = new Set(
    collectIssues(SignupFormSchema, values, formCheck).map((issue) => issue.path[0]),
  );
  return SIGNUP_STEPS.map(
    (step, index) =>
      step.fields.every((field) => !invalid.has(field)) && (index !== CEP_STEP || addressShown),
  );
}

/**
 * Whether step `target` can be entered from step `from`: every step before it is complete, `from`
 * aside (leaving it checks it, as "Próximo" does).
 */
export function canReachStep(completed: readonly boolean[], target: number, from: number): boolean {
  return completed.slice(0, target).every((done, index) => done || index === from);
}

/**
 * The address fields shown only once the CEP is looked up (found, or the lookup unavailable):
 * while hidden they neither show errors nor take focus.
 */
export const ADDRESS_DETAIL_FIELDS = [
  "street",
  "addressNumber",
  "complement",
  "neighborhood",
  "city",
  "state",
] as const satisfies readonly SignupFieldName[];

export function isAddressDetailField(name: SignupFieldName): boolean {
  return ADDRESS_DETAIL_FIELDS.some((field) => field === name);
}

/** A 422 `fields[].path`: a top-level request property or one inside `address`. */
type RequestPath = Exclude<keyof SignupRequest, "address"> | `address.${keyof Address}`;

/** Request path (as the API reports it in 422 `fields[].path`) → the form field holding it. */
const REQUEST_FIELD: Record<RequestPath, SignupFieldName> = {
  fullName: "fullName",
  cpf: "cpf",
  birthdate: "birthdate",
  "address.cep": "cep",
  "address.street": "street",
  "address.number": "addressNumber",
  "address.complement": "complement",
  "address.neighborhood": "neighborhood",
  "address.city": "city",
  "address.state": "state",
  phone: "phone",
  email: "email",
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

function brState(raw: string): BrState {
  const state = BR_STATES.find((candidate) => candidate === raw);
  if (!state) throw new Error("A validated UF isn't one of the 27");
  return state;
}

/**
 * Validated form values → the API body. A blank e-mail is left out; the scenario goes only when
 * simulation controls are on.
 */
export function toSignupRequest(
  values: SignupFormValues,
  simulationControls: boolean,
): SignupRequest {
  const email = normalizeEmail(values.email);
  return {
    fullName: values.fullName.trim(),
    cpf: normalizeCpf(values.cpf),
    birthdate: values.birthdate,
    address: normalizeAddress({
      cep: values.cep,
      street: values.street,
      number: values.addressNumber,
      complement: values.complement,
      neighborhood: values.neighborhood,
      city: values.city,
      state: brState(values.state),
    }),
    phone: normalizePhone(values.phone),
    ...(email ? { email } : {}),
    monthlyIncomeCents: cents(values.monthlyIncome),
    treatmentAmountCents: cents(values.treatmentAmount),
    ...(simulationControls ? { simulationScenario: values.simulationScenario } : {}),
  };
}

const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, DateField, CepField, StateField, MoneyField, ScenarioField },
  formComponents: {},
});

/**
 * The form's values and validation. The form-level validator runs on blur, and on submit too:
 * TanStack's submit runs the `onBlur` validator, so the same error slot serves both (a separate
 * `onSubmit` one would keep a stale second message after the next blur). Never on change: an error
 * shows once a field is left or the step submitted, and stays until the next blur or submit.
 */
export const signupFormOptions = formOptions({
  defaultValues: DEFAULT_VALUES,
  validators: { onBlur: signupValidator },
});

/** The single signup form instance (owned by the `/cadastro` layout), from a draft when restored. */
export function useSignupForm(handlers: {
  onSubmit: (values: SignupFormValues) => Promise<void>;
  onSubmitInvalid: () => void;
  initialValues?: SignupFormValues;
}) {
  return useAppForm({
    ...signupFormOptions,
    defaultValues: handlers.initialValues ?? signupFormOptions.defaultValues,
    onSubmit: ({ value }) => handlers.onSubmit(value),
    onSubmitInvalid: () => handlers.onSubmitInvalid(),
  });
}
export type SignupForm = ReturnType<typeof useSignupForm>;
