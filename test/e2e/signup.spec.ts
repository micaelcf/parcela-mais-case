import { expect, test } from "./support/fixtures";
import { birthdateForAge, centsInput } from "./support/patient";
import {
  fillContactStep,
  fillFinancialStep,
  fillPatientStep,
  scenarioRadio,
} from "./support/signup";

const STEP_FIELDS = {
  "/cadastro/paciente": ["Nome completo", "CPF", "Data de nascimento"],
  "/cadastro/contato": ["Celular com DDD"],
  "/cadastro/financeiro": ["Renda mensal", "Valor do tratamento"],
} as const;
const ALL_FIELDS = Object.values(STEP_FIELDS).flat();

test.describe("signup", () => {
  test("collects six fields across three steps", async ({ page, patient }) => {
    expect(ALL_FIELDS).toHaveLength(6);
    const submit = page.getByRole("button", { name: "Solicitar pré-aprovação" });
    const next = page.getByRole("button", { name: "Próximo" });

    await page.goto("/cadastro/paciente");
    for (const [path, fields] of Object.entries(STEP_FIELDS)) {
      await expect(page).toHaveURL(new RegExp(`${path}$`));
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
        if (path === "/cadastro/paciente") await fillPatientStep(page, patient);
        else await fillContactStep(page, patient);
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

  test("flags ages outside 18–80", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    const birthdate = page.getByLabel("Data de nascimento");
    for (const age of [17, 81]) {
      await birthdate.fill(birthdateForAge(age));
      await birthdate.blur();
      await expect(birthdate, `age ${age}`).toHaveAttribute("aria-invalid", "true");
      await expect(birthdate, `age ${age}`).toHaveAccessibleDescription(
        /idade deve estar entre 18 e 80 anos/,
      );
    }
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
    await expect(page.getByLabel("Data de nascimento")).toHaveValue(patient.birthdate);

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
