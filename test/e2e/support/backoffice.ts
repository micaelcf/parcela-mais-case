import { expect, type Page } from "@playwright/test";

/** The stack's operator credentials (the dev stack's defaults unless overridden). */
export const OPERATOR = {
  username: process.env.E2E_BACKOFFICE_USERNAME ?? "operador",
  password: process.env.E2E_BACKOFFICE_PASSWORD ?? "parcela123",
};

export async function fillLogin(page: Page, username: string, password: string) {
  await page.goto("/backoffice/login");
  await page.getByLabel("Usuário").fill(username);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Signs the operator in through the login form; resolves on the dashboard. */
export async function logIn(page: Page) {
  await fillLogin(page, OPERATOR.username, OPERATOR.password);
  await expect(page).toHaveURL(/\/backoffice$/);
}
