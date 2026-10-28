import { randomUUID } from "node:crypto";

import { type APIRequestContext, expect, type Page } from "@playwright/test";

import type { SimulationScenario } from "#/lib/enums";

import { centsInput, dateText, type Patient } from "./patient";

/** The picker's option labels (accessible names start with them). */
export const SCENARIO_LABEL: Record<SimulationScenario, string> = {
  NORMAL: "Normal",
  ALL_APPROVE: "Todas aprovam",
  DELTA_FAILS: "Delta falha",
  DELTA_TIMES_OUT: "Delta não responde a tempo",
  NONE_APPROVE: "Nenhuma aprova",
};

export const FORCED_SCENARIOS = [
  "ALL_APPROVE",
  "DELTA_FAILS",
  "DELTA_TIMES_OUT",
  "NONE_APPROVE",
] as const satisfies readonly SimulationScenario[];

export function scenarioRadio(page: Page, scenario: SimulationScenario) {
  return page.getByRole("radio", { name: new RegExp(`^${SCENARIO_LABEL[scenario]}`) });
}

export const CONSULTATION_URL = /\/consultas\/([0-9a-f-]{36})$/;

/** Fills step 1: the CEP is looked up (the fake answers), then the number completes the address. */
export async function fillPatientStep(page: Page, patient: Patient) {
  await page.getByLabel("Nome completo").fill(patient.fullName);
  await page.getByLabel("CPF", { exact: true }).fill(patient.cpf);
  await page.getByLabel("Data de nascimento").fill(dateText(patient.birthdate));
  await page.getByLabel("CEP", { exact: true }).fill(patient.address.cep);
  const number = page.getByLabel("Número");
  await expect(number).toBeVisible();
  await number.fill(patient.address.number);
  if (patient.address.complement) {
    await page.getByLabel("Complemento (opcional)").fill(patient.address.complement);
  }
}

/** Fills step 2: the phone, and the e-mail when the patient has one (it's optional). */
export async function fillContactStep(page: Page, patient: Patient) {
  await page.getByLabel("Celular com DDD").fill(patient.phone);
  if (patient.email) await page.getByLabel("E-mail (opcional)").fill(patient.email);
}

/** The signup stepper: "Etapa N de 3" over the three steps (`listitem`s, in order). */
export function signupStepper(page: Page) {
  return page.getByRole("navigation", { name: "Etapas do cadastro" });
}

export async function fillFinancialStep(page: Page, patient: Patient) {
  await page.getByLabel("Renda mensal").fill(centsInput(patient.monthlyIncomeCents));
  await page.getByLabel("Valor do tratamento").fill(centsInput(patient.treatmentAmountCents));
}

/** Fills the three signup steps in the browser and submits; resolves to the new consultation id. */
export async function signUp(
  page: Page,
  patient: Patient,
  scenario: SimulationScenario = "NORMAL",
): Promise<string> {
  await page.goto("/cadastro/paciente");
  await fillPatientStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/contato$/);
  await fillContactStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
  await fillFinancialStep(page, patient);
  await scenarioRadio(page, scenario).check();
  await page.getByRole("button", { name: "Solicitar pré-aprovação" }).click();
  await expect(page).toHaveURL(CONSULTATION_URL);
  return CONSULTATION_URL.exec(page.url())![1];
}

/** The `POST /api/consultations` body for `patient`. */
export function signupBody(patient: Patient, scenario?: SimulationScenario) {
  return {
    fullName: patient.fullName,
    cpf: patient.cpf,
    birthdate: patient.birthdate,
    address: patient.address,
    phone: patient.phone,
    ...(patient.email ? { email: patient.email } : {}),
    monthlyIncomeCents: patient.monthlyIncomeCents,
    treatmentAmountCents: patient.treatmentAmountCents,
    ...(scenario ? { simulationScenario: scenario } : {}),
  };
}

/** Creates a consultation through the public API (`POST /api/consultations`); resolves to its id. */
export async function createConsultation(
  request: APIRequestContext,
  patient: Patient,
  scenario?: SimulationScenario,
): Promise<string> {
  const response = await request.post("/api/consultations", {
    headers: { "Idempotency-Key": randomUUID() },
    data: signupBody(patient, scenario),
  });
  expect(response.status(), await response.text()).toBe(202);
  const { id } = (await response.json()) as { id: string };
  return id;
}
