import { expect, test } from "./support/fixtures";
import { birthdateForAge, centsInput, dateText } from "./support/patient";
import {
  CONSULTATION_URL,
  fillContactStep,
  fillFinancialStep,
  fillPatientStep,
  scenarioRadio,
  signupStepper,
} from "./support/signup";

/** Every field's label by step; step 1's address fields show once the CEP is looked up. */
const STEP_FIELDS = {
  "/cadastro/paciente": [
    "Nome completo",
    "CPF",
    "Data de nascimento",
    "CEP",
    "Rua",
    "Número",
    "Complemento (opcional)",
    "Bairro",
    "Cidade",
    "UF",
  ],
  "/cadastro/contato": ["Celular com DDD", "E-mail (opcional)"],
  "/cadastro/financeiro": ["Renda mensal", "Valor do tratamento"],
} as const;
const ALL_FIELDS = Object.values(STEP_FIELDS).flat();

test.describe("signup", () => {
  test("collects fourteen fields across three steps", async ({ page, patient }) => {
    expect(ALL_FIELDS).toHaveLength(14);
    const submit = page.getByRole("button", { name: "Solicitar pré-aprovação" });
    const next = page.getByRole("button", { name: "Próximo" });

    await page.goto("/cadastro/paciente");
    for (const [path, fields] of Object.entries(STEP_FIELDS)) {
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      if (path === "/cadastro/paciente") await fillPatientStep(page, patient);
      for (const label of ALL_FIELDS) {
        const field = page.getByLabel(label, { exact: true });
        if ((fields as readonly string[]).includes(label)) await expect(field).toBeVisible();
        else await expect(field).toHaveCount(0);
      }
      if (path === "/cadastro/financeiro") {
        await expect(submit).toBeVisible();
        await expect(next).toHaveCount(0);
      } else {
        await expect(submit).toHaveCount(0);
        if (path === "/cadastro/contato") await fillContactStep(page, patient);
        await next.click();
      }
    }
  });

  test("flags an invalid CPF on the field", async ({ page, patient }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    const cpf = page.getByLabel("CPF", { exact: true });
    await cpf.fill("529.982.247-24");
    await cpf.blur();

    await expect(cpf).toHaveAttribute("aria-invalid", "true");
    await expect(cpf).toHaveAccessibleDescription("CPF inválido");
    const describedBy = await cpf.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("CPF inválido");

    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByLabel("Celular com DDD")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(cpf).toHaveAccessibleDescription("CPF inválido");
  });

  test("validates a field when it's left, not while it's typed", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    const name = page.getByLabel("Nome completo");
    const cpf = page.getByLabel("CPF", { exact: true });

    // Leaving the name validates the whole form, the untouched CPF included: still hidden.
    await name.fill("Ana");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await name.blur();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription("Informe nome e sobrenome");

    await cpf.pressSequentially("529982");
    await expect(cpf).toHaveValue("529.982");
    await expect(cpf).not.toHaveAttribute("aria-invalid", "true");
    await expect(cpf).toHaveAccessibleDescription("");
    await cpf.blur();
    await expect(cpf).toHaveAttribute("aria-invalid", "true");
    await expect(cpf).toHaveAccessibleDescription("CPF inválido");

    // The error stays while the CPF is fixed, until it's left again.
    await cpf.focus();
    await page.keyboard.press("End");
    await page.keyboard.type("24725");
    await expect(cpf).toHaveValue("529.982.247-25");
    await expect(cpf).toHaveAccessibleDescription("CPF inválido");
    await cpf.blur();
    await expect(cpf).not.toHaveAttribute("aria-invalid", "true");
    await expect(cpf).toHaveAccessibleDescription("");
  });

  test("marks the active step in the stepper", async ({ page, patient }) => {
    const stepper = signupStepper(page);
    const steps = stepper.getByRole("listitem");
    const next = page.getByRole("button", { name: "Próximo" });
    const titles = ["Paciente", "Contato", "Financeiro"];

    const expectActive = async (active: number) => {
      await expect(stepper).toContainText(`Etapa ${active + 1} de 3`);
      await expect(steps).toHaveCount(3);
      for (const [index, title] of titles.entries()) {
        const step = steps.nth(index);
        await expect(step).toContainText(title);
        const status = index < active ? "complete" : index === active ? "active" : "upcoming";
        await expect(step, title).toHaveAttribute("data-status", status);
        if (index === active) await expect(step, title).toHaveAttribute("aria-current", "step");
        else await expect(step, title).not.toHaveAttribute("aria-current");
        // Only completed steps take you back; the others aren't buttons.
        const back = step.getByRole("button", { name: `${title} (concluída)` });
        await expect(back, title).toHaveCount(index < active ? 1 : 0);
      }
    };

    await page.goto("/cadastro/paciente");
    await expectActive(0);
    await fillPatientStep(page, patient);
    await next.click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expectActive(1);
    await fillContactStep(page, patient);
    await next.click();
    await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
    await expectActive(2);

    // A completed step goes back to it, focus on its first field.
    await stepper.getByRole("button", { name: "Contato (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expectActive(1);
    await expect(page.getByLabel("Celular com DDD")).toBeFocused();
    await stepper.getByRole("button", { name: "Paciente (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expectActive(0);
    await expect(page.getByLabel("Nome completo")).toBeFocused();
    await expect(page.getByLabel("Nome completo")).toHaveValue(patient.fullName);
  });

  test("keeps the e-mail optional", async ({ page, patient }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    const email = page.getByLabel("E-mail (opcional)");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(page.locator("form")).toHaveAttribute("novalidate", "");
    await fillContactStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillFinancialStep(page, patient);

    const signup = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/api/consultations"),
    );
    await page.getByRole("button", { name: "Solicitar pré-aprovação" }).click();
    expect((await signup).postDataJSON()).not.toHaveProperty("email");
    await expect(page).toHaveURL(CONSULTATION_URL);
  });

  test("flags an invalid e-mail when it's left and sends a valid one normalised", async ({
    page,
    patient,
  }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillContactStep(page, patient);
    const email = page.getByLabel("E-mail (opcional)");
    const message = "Informe um e-mail válido, ex.: nome@exemplo.com";

    await email.pressSequentially("ana@clinica");
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await email.blur();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(message);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expect(email).toBeFocused();

    await email.fill(" Ana@Clinica.COM ");
    await email.blur();
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillFinancialStep(page, patient);
    const signup = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/api/consultations"),
    );
    await page.getByRole("button", { name: "Solicitar pré-aprovação" }).click();
    expect((await signup).postDataJSON()).toMatchObject({ email: "ana@clinica.com" });
    await expect(page).toHaveURL(CONSULTATION_URL);
  });

  test("flags ages outside 18–80", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    const birthdate = page.getByLabel("Data de nascimento");
    for (const age of [17, 81]) {
      await birthdate.fill(dateText(birthdateForAge(age)));
      await birthdate.blur();
      await expect(birthdate, `age ${age}`).toHaveAttribute("aria-invalid", "true");
      await expect(birthdate, `age ${age}`).toHaveAccessibleDescription(
        /idade deve estar entre 18 e 80 anos/,
      );
    }
  });

  test("picks the birthdate from the calendar", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    const birthdate = page.getByLabel("Data de nascimento");
    const opener = page.getByRole("button", { name: "Selecionar data" });
    const year = new Date().getFullYear() - 40;

    await opener.click();
    const calendar = page.getByRole("dialog");
    await calendar.getByRole("combobox", { name: "Escolha o ano" }).selectOption(String(year));
    // Month options are valued by index: May is 4.
    await calendar.getByRole("combobox", { name: "Escolha o mês" }).selectOption("4");
    await calendar.locator(`button[data-day="17/05/${year}"]`).click();

    await expect(calendar).toHaveCount(0);
    await expect(birthdate).toHaveValue(`17/05/${year}`);
    await expect(opener).toBeFocused();
    await page.getByLabel("Nome completo").focus();
    await expect(birthdate).not.toHaveAttribute("aria-invalid", "true");

    // Typing works the same way, and an impossible day stays invalid.
    await birthdate.fill("31/02/1990");
    await birthdate.blur();
    await expect(birthdate).toHaveAttribute("aria-invalid", "true");
    await expect(birthdate).toHaveAccessibleDescription(/idade deve estar entre 18 e 80 anos/);
  });

  test("flags amounts outside the bounds", async ({ page }) => {
    await page.goto("/cadastro/financeiro");
    const amount = page.getByLabel("Valor do tratamento");
    const hint = "Entre R$ 1.000,00 e R$ 50.000,00.";
    for (const [typed, valid] of [
      ["999,99", false],
      ["50.000,01", false],
      ["1.000,00", true],
      ["50.000,00", true],
    ] as const) {
      await amount.fill(typed);
      await amount.blur();
      if (valid) {
        await expect(amount, typed).not.toHaveAttribute("aria-invalid", "true");
        await expect(amount, typed).toHaveAccessibleDescription(hint);
      } else {
        await expect(amount, typed).toHaveAttribute("aria-invalid", "true");
        await expect(amount, typed).toHaveAccessibleDescription(
          "O valor deve estar entre R$ 1.000,00 e R$ 50.000,00",
        );
      }
    }
  });

  test("keeps values when moving back", async ({ page, patient }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillContactStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/financeiro$/);

    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(page.getByLabel("Nome completo")).toHaveValue(patient.fullName);
    await expect(page.getByLabel("CPF", { exact: true })).toHaveValue(patient.cpfFormatted);
    await expect(page.getByLabel("Data de nascimento")).toHaveValue(dateText(patient.birthdate));
    await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("01310-100");
    await expect(page.getByLabel("Rua")).toHaveValue(patient.address.street);
    await expect(page.getByLabel("Número")).toHaveValue(patient.address.number);

    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expect(page.getByLabel("Celular com DDD")).toHaveValue("(11) 98765-4321");
  });

  test("stores nothing in the browser", async ({ page, patient }) => {
    const entered = [
      patient.fullName,
      patient.token,
      patient.cpf,
      patient.cpfFormatted,
      patient.birthdate,
      dateText(patient.birthdate),
      patient.address.cep,
      "01310-100",
      patient.address.street,
      patient.phone,
      "(11) 98765-4321",
      centsInput(patient.monthlyIncomeCents),
      centsInput(patient.treatmentAmountCents),
    ];
    const storedValues = () =>
      page.evaluate(() =>
        [localStorage, sessionStorage].flatMap((storage) =>
          Object.keys(storage).flatMap((key) => [key, storage.getItem(key) ?? ""]),
        ),
      );
    const expectNothingEntered = async (when: string) => {
      const stored = (await storedValues()).join("\n");
      for (const value of entered) expect(stored, `${when}: ${value}`).not.toContain(value);
    };

    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillContactStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillFinancialStep(page, patient);
    await expect(page.getByLabel("Valor do tratamento")).toHaveValue(
      centsInput(patient.treatmentAmountCents),
    );
    await expectNothingEntered("before reload");

    await page.reload();
    await expect(page.getByLabel("Renda mensal")).toBeVisible();
    await expectNothingEntered("after reload");
    await expect(page.getByLabel("Renda mensal")).toHaveValue("");
    await expect(page.getByLabel("Valor do tratamento")).toHaveValue("");
    // Back to the earlier steps without the mouse: this check is about storage, not navigation.
    await page.getByRole("button", { name: "Voltar" }).press("Enter");
    await expect(page.getByLabel("Celular com DDD")).toHaveValue("");
    await page.getByRole("button", { name: "Voltar" }).press("Enter");
    await expect(page.getByLabel("Nome completo")).toHaveValue("");
    await expect(page.getByLabel("CPF", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Data de nascimento")).toHaveValue("");
    await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Rua")).toHaveCount(0);
  });

  test("hides the scenario picker when controls are off", async ({ page }) => {
    let configServed = false;
    await page.route("**/api/config", async (route) => {
      configServed = true;
      await route.fulfill({ json: { simulationControls: false } });
    });

    await page.goto("/cadastro/financeiro");
    await expect(page.getByLabel("Valor do tratamento")).toBeVisible();
    expect(configServed).toBe(true);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    await expect(scenarioRadio(page, "ALL_APPROVE")).toHaveCount(0);
    await expect(page.getByText("Cenário de simulação")).toHaveCount(0);
  });
});
