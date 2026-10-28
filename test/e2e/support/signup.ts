import { randomUUID } from "node:crypto";

import { type APIRequestContext, expect, type Page } from "@playwright/test";

import type { SimulationScenario } from "#/lib/enums";

import { centsInput, type Patient } from "./patient";

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

export async function fillPatientStep(page: Page, patient: Patient) {
  await page.getByLabel("Nome completo").fill(patient.fullName);
  await page.getByLabel("CPF", { exact: true }).fill(patient.cpf);
  await page.getByLabel("Data de nascimento").fill(patient.birthdate);
}

export async function fillContactStep(page: Page, patient: Patient) {
  await page.getByLabel("Celular com DDD").fill(patient.phone);
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

/** Creates a consultation through the public API (`POST /api/consultations`); resolves to its id. */
export async function createConsultation(
  request: APIRequestContext,
  patient: Patient,
  scenario?: SimulationScenario,
): Promise<string> {
  const response = await request.post("/api/consultations", {
    headers: { "Idempotency-Key": randomUUID() },
    data: {
      fullName: patient.fullName,
      cpf: patient.cpf,
      birthdate: patient.birthdate,
      phone: patient.phone,
      monthlyIncomeCents: patient.monthlyIncomeCents,
      treatmentAmountCents: patient.treatmentAmountCents,
      ...(scenario ? { simulationScenario: scenario } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  const { id } = (await response.json()) as { id: string };
  return id;
}
