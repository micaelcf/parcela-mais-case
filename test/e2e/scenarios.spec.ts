import type { Page } from "@playwright/test";

import { expect, journeyTest as test } from "./support/fixtures";
import { LENDERS, lenderCard, offerRows } from "./support/journey";
import type { Patient } from "./support/patient";
import {
  CONSULTATION_URL,
  fillContactStep,
  fillFinancialStep,
  fillPatientStep,
  FORCED_SCENARIOS,
  scenarioRadio,
} from "./support/signup";

/** Signs up through the picker, checking it offers every forced scenario, and runs `scenario`. */
async function runScenario(
  page: Page,
  patient: Patient,
  scenario: (typeof FORCED_SCENARIOS)[number],
) {
  await page.goto("/cadastro/paciente");
  await fillPatientStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await fillContactStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await fillFinancialStep(page, patient);

  const picker = page.getByRole("radiogroup", { name: "Cenário de simulação" });
  await expect(picker).toBeVisible();
  for (const forced of FORCED_SCENARIOS) await expect(scenarioRadio(page, forced)).toBeVisible();

  await scenarioRadio(page, scenario).check();
  await page.getByRole("button", { name: "Solicitar pré-aprovação" }).click();
  await expect(page).toHaveURL(CONSULTATION_URL);
}

const offersHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Compare as ofertas e escolha a melhor" });

test.describe("forced scenarios", () => {
  test("ALL_APPROVE ends with four approvals and their offers", async ({ page, patient }) => {
    await runScenario(page, patient, "ALL_APPROVE");
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("aprovada");
    await expect(offersHeading(page)).toBeVisible();
    for (const { code } of LENDERS) await expect(offerRows(page, code)).toHaveCount(3);
  });

  test("DELTA_FAILS ends with Delta unavailable and the others' offers", async ({
    page,
    patient,
  }) => {
    await runScenario(page, patient, "DELTA_FAILS");
    for (const name of ["Alfa", "Beta", "Gama"] as const) {
      await expect(lenderCard(page, name)).toContainText("aprovada");
    }
    const delta = lenderCard(page, "Delta");
    await expect(delta).toContainText("indisponível");
    await expect(delta).toContainText("a financeira teve uma falha ao responder");
    await expect(offersHeading(page)).toBeVisible();
    for (const code of ["ALFA", "BETA", "GAMA"] as const) {
      await expect(offerRows(page, code)).toHaveCount(3);
    }
    await expect(offerRows(page, "DELTA")).toHaveCount(0);
  });

  test("DELTA_TIMES_OUT ends with Delta past the deadline and the others' offers", async ({
    page,
    patient,
  }) => {
    await runScenario(page, patient, "DELTA_TIMES_OUT");
    for (const name of ["Alfa", "Beta", "Gama"] as const) {
      await expect(lenderCard(page, name)).toContainText("aprovada");
    }
    const delta = lenderCard(page, "Delta");
    await expect(delta).toContainText("indisponível");
    await expect(delta).toContainText("sem resposta dentro do prazo");
    await expect(offersHeading(page)).toBeVisible();
    for (const code of ["ALFA", "BETA", "GAMA"] as const) {
      await expect(offerRows(page, code)).toHaveCount(3);
    }
    await expect(offerRows(page, "DELTA")).toHaveCount(0);
  });

  test("NONE_APPROVE ends with four refusals and the no-offer panel", async ({ page, patient }) => {
    await runScenario(page, patient, "NONE_APPROVE");
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("recusada");
    await expect(
      page.getByRole("heading", { level: 1, name: "Nenhuma oferta desta vez" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Nenhuma financeira aprovou/ })).toBeVisible();
    await expect(offerRows(page)).toHaveCount(0);
  });
});
