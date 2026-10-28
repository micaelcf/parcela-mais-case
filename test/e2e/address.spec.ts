import type { Page } from "@playwright/test";

import {
  CITY_WIDE,
  formatCep,
  PAULISTA,
  UNAVAILABLE_CEP,
  UNKNOWN_CEP,
} from "./support/address-lookup";
import { logIn } from "./support/backoffice";
import { expect, journeyTest as test } from "./support/fixtures";
import { dateText, type Patient } from "./support/patient";
import {
  CONSULTATION_URL,
  fillContactStep,
  fillFinancialStep,
  reviewAndSubmit,
  scenarioRadio,
} from "./support/signup";

const ADDRESS_LABELS = ["Rua", "Número", "Complemento (opcional)", "Bairro", "Cidade", "UF"];
const UNAVAILABLE_HINT = "Não foi possível consultar o CEP agora. Preencha o endereço.";

function cepField(page: Page) {
  return page.getByLabel("CEP", { exact: true });
}

async function expectAddressHidden(page: Page) {
  for (const label of ADDRESS_LABELS) {
    await expect(page.getByLabel(label, { exact: true }), label).toHaveCount(0);
  }
}

/** Step 1 up to the CEP: name, CPF and birthdate. */
async function fillPatientIdentity(page: Page, patient: Patient) {
  await page.getByLabel("Nome completo").fill(patient.fullName);
  await page.getByLabel("CPF", { exact: true }).fill(patient.cpf);
  await page.getByLabel("Data de nascimento").fill(dateText(patient.birthdate));
}

/** Holds every CEP lookup of `page` until the returned release is called. */
async function holdLookups(page: Page): Promise<() => void> {
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/api/addresses/*", async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}

test.describe("patient address", () => {
  // Straight to the app, past the browser fake: fails if the lookup route ever stops being served
  // (e.g. a module stubbed out of the server bundle). A malformed CEP never reaches ViaCEP.
  test("answers a malformed CEP from the real route", async ({ request }) => {
    const response = await request.get("/api/addresses/12345");
    expect(response.status()).toBe(422);
    expect(response.headers()["content-type"]).toContain("application/problem+json");
    const body = await response.json();
    expect(body).toMatchObject({ code: "VALIDATION" });
    expect(body.fields[0]).toEqual({ path: "cep", message: "CEP inválido" });
  });

  test("shows the address fields only once the CEP is found", async ({ page, addressLookups }) => {
    await page.goto("/cadastro/paciente");
    await expect(cepField(page)).toBeVisible();
    await expect(cepField(page)).toHaveAttribute("inputmode", "numeric");
    await expect(cepField(page)).toHaveAttribute("autocomplete", "postal-code");
    await expect(cepField(page)).toHaveAttribute("placeholder", "00000-000");
    await expectAddressHidden(page);

    await cepField(page).pressSequentially("0131010");
    await expect(cepField(page)).toHaveValue("01310-10");
    await expectAddressHidden(page);
    expect(addressLookups).toEqual([]);

    await cepField(page).press("0");
    await expect(cepField(page)).toHaveValue("01310-100");
    const number = page.getByLabel("Número");
    await expect(number).toBeFocused();
    await expect(number).toHaveValue("");
    await expect(page.getByLabel("Rua")).toHaveValue(PAULISTA.street);
    await expect(page.getByLabel("Bairro")).toHaveValue(PAULISTA.neighborhood);
    await expect(page.getByLabel("Complemento (opcional)")).toHaveValue("");
    const city = page.getByLabel("Cidade");
    const state = page.getByLabel("UF", { exact: true });
    await expect(city).toHaveValue(PAULISTA.city);
    await expect(state).toHaveValue(PAULISTA.state);
    await expect(city).toHaveAttribute("readonly", "");
    await expect(state).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("Rua")).toBeEditable();
    await expect(page.getByLabel("Bairro")).toBeEditable();
    // Nothing shows an error before the patient touches it.
    await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
    expect(addressLookups).toEqual([PAULISTA.cep]);
  });

  test("announces the lookup while it runs", async ({ page }) => {
    const release = await holdLookups(page);
    await page.goto("/cadastro/paciente");
    await cepField(page).fill(formatCep(PAULISTA.cep));

    const status = page.getByRole("status").filter({ hasText: "Buscando endereço…" });
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("id", /signup-cep-status/);
    await expect(cepField(page)).toHaveAccessibleDescription("Buscando endereço…");
    await expectAddressHidden(page);

    release();
    await expect(page.getByLabel("Número")).toBeFocused();
    await expect(page.getByText("Buscando endereço…")).toHaveCount(0);
  });

  test("flags a CEP that doesn't exist once it's left", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    await cepField(page).fill(formatCep(UNKNOWN_CEP));

    // The lookup answers while the CEP is still focused: no verdict until it's left.
    await expect(page.getByRole("status").filter({ hasText: "Buscando endereço…" })).toHaveCount(0);
    await expect(cepField(page)).not.toHaveAttribute("aria-invalid", "true");
    await cepField(page).blur();
    await expect(cepField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(cepField(page)).toHaveAccessibleDescription("CEP não encontrado");
    await expectAddressHidden(page);
  });

  test("lets the patient type the address when the lookup is unavailable", async ({
    page,
    patient,
  }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientIdentity(page, patient);
    await cepField(page).fill(formatCep(UNAVAILABLE_CEP));

    await expect(page.getByRole("status").filter({ hasText: UNAVAILABLE_HINT })).toBeVisible();
    await expect(cepField(page)).not.toHaveAttribute("aria-invalid", "true");
    for (const label of ["Rua", "Número", "Complemento (opcional)", "Bairro", "Cidade"]) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field, label).toHaveValue("");
      await expect(field, label).toBeEditable();
    }
    await page.getByLabel("Rua").fill("Rua das Laranjeiras");
    await page.getByLabel("Número").fill("S/N");
    await page.getByLabel("Complemento (opcional)").fill("Casa 2");
    await page.getByLabel("Bairro").fill("Laranjeiras");
    await page.getByLabel("Cidade").fill("Rio de Janeiro");

    // "Próximo" without a UF stops on the UF picker.
    await page.getByRole("button", { name: "Próximo" }).click();
    const state = page.getByRole("combobox", { name: "UF" });
    await expect(state).toBeFocused();
    await expect(state).toHaveAccessibleDescription("Selecione a UF");
    await state.click();
    await page.getByRole("option", { name: "RJ", exact: true }).click();
    await expect(state).toHaveText(/RJ/);

    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await fillContactStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillFinancialStep(page, patient);
    await scenarioRadio(page, "ALL_APPROVE").check();
    await reviewAndSubmit(page);
    const id = CONSULTATION_URL.exec(page.url())![1];

    await logIn(page);
    await page.goto(`/backoffice/consultas/${id}`);
    const patientFacts = page.locator("dl", { hasText: "Celular" });
    await expect(patientFacts).toContainText(formatCep(UNAVAILABLE_CEP));
    await expect(patientFacts).toContainText("Rua das Laranjeiras, S/N – Casa 2");
    await expect(patientFacts).toContainText("Laranjeiras");
    await expect(patientFacts).toContainText("Rio de Janeiro/RJ");
  });

  test("refills the address when the CEP changes", async ({ page, patient, addressLookups }) => {
    await page.goto("/cadastro/paciente");
    await cepField(page).fill(formatCep(PAULISTA.cep));
    await page.getByLabel("Número").fill(patient.address.number);
    await page.getByLabel("Complemento (opcional)").fill("Apto 12");

    await cepField(page).fill(formatCep(CITY_WIDE.cep));
    await expect(page.getByLabel("Cidade")).toHaveValue(CITY_WIDE.city);
    await expect(page.getByLabel("UF", { exact: true })).toHaveValue(CITY_WIDE.state);
    // A city-wide CEP knows no street or neighbourhood: those stay editable and empty.
    await expect(page.getByLabel("Rua")).toHaveValue("");
    await expect(page.getByLabel("Bairro")).toHaveValue("");
    await expect(page.getByLabel("Número")).toHaveValue("");
    await expect(page.getByLabel("Complemento (opcional)")).toHaveValue("");
    await expect(page.getByLabel("Número")).toBeFocused();
    expect(addressLookups).toEqual([PAULISTA.cep, CITY_WIDE.cep]);

    // An empty street then blocks "Próximo" on the street, now that it's shown.
    await page.getByLabel("Número").fill("100");
    await page.getByLabel("Bairro").fill("Zona Cívico-Administrativa");
    await fillPatientIdentity(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByLabel("Rua")).toBeFocused();
    await expect(page.getByLabel("Rua")).toHaveAccessibleDescription("Informe a rua");
  });

  test("keeps Próximo on the step until the CEP resolves", async ({ page, patient }) => {
    const next = page.getByRole("button", { name: "Próximo" });
    await page.goto("/cadastro/paciente");
    await fillPatientIdentity(page, patient);

    // Empty CEP.
    await next.click();
    await expect(cepField(page)).toBeFocused();
    await expect(cepField(page)).toHaveAccessibleDescription("CEP inválido");

    // Unknown CEP.
    await cepField(page).fill(formatCep(UNKNOWN_CEP));
    await page.getByLabel("Nome completo").focus();
    await expect(cepField(page)).toHaveAccessibleDescription("CEP não encontrado");
    await next.click();
    await expect(cepField(page)).toBeFocused();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expectAddressHidden(page);

    // A valid CEP still being looked up.
    const release = await holdLookups(page);
    await cepField(page).fill(formatCep(PAULISTA.cep));
    await page.getByLabel("Nome completo").focus();
    await next.click();
    await expect(cepField(page)).toBeFocused();
    await expect(cepField(page)).toHaveAccessibleDescription("Informe o CEP e aguarde o endereço");
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expectAddressHidden(page);

    release();
    await expect(page.getByLabel("Número")).toBeFocused();
    await expect(cepField(page)).not.toHaveAttribute("aria-invalid", "true");
    // The revealed fields don't open with errors.
    await expect(page.getByLabel("Número")).not.toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Número").fill(patient.address.number);
    await next.click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
  });
});
