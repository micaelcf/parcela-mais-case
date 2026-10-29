import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, journeyTest as test, test as plainTest } from "./support/fixtures";
import { createConsultation } from "./support/signup";

const pageHeading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

plainTest.describe("error pages", () => {
  plainTest("an unknown address shows a 404 with a way back", async ({ page }) => {
    await page.goto("/nada-por-aqui");
    await expect(pageHeading(page, "Erro 404: Página não encontrada")).toBeFocused();

    await page.getByRole("link", { name: "Voltar ao início" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
  });

  plainTest("an unknown consultation shows its own 404", async ({ page }) => {
    await page.goto(`/consultas/${randomUUID()}`);
    await expect(pageHeading(page, "Erro 404: Consulta não encontrada")).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo cadastro" })).toBeVisible();
  });
});

test("an API outage shows a 503 page, and trying again recovers", async ({
  page,
  request,
  patient,
}) => {
  const id = await createConsultation(request, patient, "ALL_APPROVE");
  const consultation = `**/api/consultations/${id}`;
  await page.route(consultation, (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "Service Unavailable" }),
  );
  await page.goto(`/consultas/${id}`);
  await expect(pageHeading(page, "Erro 503: Serviço indisponível")).toBeVisible();

  await page.unroute(consultation);
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Erro");
  await expect(page.getByRole("status", { name: "Alfa", exact: true })).toBeVisible();
});
