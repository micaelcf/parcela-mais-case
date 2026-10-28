import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";
import { birthdateForAge, centsInput, dateText, type Patient } from "./support/patient";
import {
  CONSULTATION_URL,
  fillContactStep,
  fillFinancialStep,
  fillPatientStep,
  scenarioRadio,
  signupBody,
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
  "/cadastro/revisao": [],
} as const;
const ALL_FIELDS = Object.values(STEP_FIELDS).flat();

/** Fills the first two steps and moves on to the financial one. */
async function reachFinancialStep(page: Page, patient: Patient) {
  await page.goto("/cadastro/paciente");
  await fillPatientStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/contato$/);
  await fillContactStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
}

/** Fills every step and moves on to the review. */
async function reachReview(page: Page, patient: Patient) {
  await reachFinancialStep(page, patient);
  await fillFinancialStep(page, patient);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/revisao$/);
}

function isSignupPost(request: { method(): string; url(): string }) {
  return request.method() === "POST" && request.url().endsWith("/api/consultations");
}

test.describe("signup", () => {
  test("collects fourteen fields across three steps, then reviews them", async ({
    page,
    patient,
  }) => {
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
      if (path === "/cadastro/revisao") {
        await expect(submit).toBeVisible();
        await expect(next).toHaveCount(0);
      } else {
        await expect(submit).toHaveCount(0);
        if (path === "/cadastro/contato") await fillContactStep(page, patient);
        if (path === "/cadastro/financeiro") await fillFinancialStep(page, patient);
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
    const titles = ["Paciente", "Contato", "Financeiro", "Revisão"];

    /** `active` is the current step; the steps up to `reachable` can be picked, the rest can't. */
    const expectActive = async (active: number, reachable: number) => {
      await expect(stepper).toContainText(`Etapa ${active + 1} de 4`);
      await expect(steps).toHaveCount(4);
      for (const [index, title] of titles.entries()) {
        const step = steps.nth(index);
        await expect(step).toContainText(title);
        const status = index < active ? "complete" : index === active ? "active" : "upcoming";
        await expect(step, title).toHaveAttribute("data-status", status);
        if (index === active) await expect(step, title).toHaveAttribute("aria-current", "step");
        else await expect(step, title).not.toHaveAttribute("aria-current");
        // Completed steps take you back, reachable ones ahead; the others aren't buttons.
        const name = index < active ? `${title} (concluída)` : title;
        const button = step.getByRole("button", { name, exact: true });
        const pickable = index !== active && index <= reachable;
        await expect(button, title).toHaveCount(pickable ? 1 : 0);
        if (index > reachable) {
          await expect(step, title).toHaveAttribute("data-locked", "true");
          await expect(step, title).toContainText("conclua as etapas anteriores");
        } else {
          await expect(step, title).not.toHaveAttribute("data-locked");
        }
      }
    };

    // The next step is always offered (picking it checks this one, as "Próximo" does).
    await page.goto("/cadastro/paciente");
    await expectActive(0, 1);
    await fillPatientStep(page, patient);
    await next.click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expectActive(1, 2);
    await fillContactStep(page, patient);
    await next.click();
    await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
    await expectActive(2, 3);

    // A completed step goes back to it, focus on its first field.
    await stepper.getByRole("button", { name: "Contato (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expectActive(1, 2);
    await expect(page.getByLabel("Celular com DDD")).toBeFocused();
    await stepper.getByRole("button", { name: "Paciente (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expectActive(0, 2);
    await expect(page.getByLabel("Nome completo")).toBeFocused();
    await expect(page.getByLabel("Nome completo")).toHaveValue(patient.fullName);

    // Ahead past the complete steps, by keyboard.
    await stepper.getByRole("button", { name: "Financeiro", exact: true }).press("Enter");
    await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
    await expectActive(2, 3);
    await expect(page.getByLabel("Renda mensal")).toBeFocused();
  });

  test("starts over on the first step after a reload on a later one", async ({ page, patient }) => {
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);

    await page.reload();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(page.getByLabel("Nome completo")).toHaveValue("");
    await expect(page.getByLabel("CPF", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("");
    // Nothing scolds the fields the patient hasn't touched since.
    await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
    await expect(page.locator("[data-slot=field-error]")).toHaveCount(0);
    await expect(signupStepper(page)).toContainText("Etapa 1 de 4");
  });

  test("sends a later step opened directly to the first one", async ({ page }) => {
    for (const path of ["/cadastro/financeiro", "/cadastro/revisao"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/cadastro\/paciente$/);
      await expect(page.getByLabel("Nome completo"), path).toBeVisible();
      await expect(page.locator("[aria-invalid=true]"), path).toHaveCount(0);
    }
  });

  test("jumps ahead from the stepper over complete steps", async ({ page, patient }) => {
    const stepper = signupStepper(page);
    await reachReview(page, patient);
    await stepper.getByRole("button", { name: "Paciente (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);

    const requests: string[] = [];
    page.on("request", (request) => {
      if (isSignupPost(request)) requests.push(request.url());
    });
    await stepper.getByRole("button", { name: "Revisão", exact: true }).click();
    await expect(page).toHaveURL(/\/cadastro\/revisao$/);
    await expect(page.getByRole("heading", { level: 1, name: "Revise os dados" })).toBeFocused();
    const review = page.getByRole("region", { name: "Paciente" });
    await expect(review).toContainText(patient.fullName);
    await expect(review).toContainText(patient.cpfFormatted);
    await expect(page.getByRole("region", { name: "Financeiro" })).toContainText(
      `R$ ${centsInput(patient.treatmentAmountCents)}`,
    );
    expect(requests).toEqual([]);
  });

  test("stops a stepper jump at an incomplete step, showing its errors", async ({
    page,
    patient,
  }) => {
    const stepper = signupStepper(page);
    await reachReview(page, patient);
    await stepper.getByRole("button", { name: "Contato (concluída)" }).click();
    const phone = page.getByLabel("Celular com DDD");
    await expect(phone).toBeFocused();
    await phone.fill("(11) 9876");

    await stepper.getByRole("button", { name: "Revisão", exact: true }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(phone).not.toHaveAccessibleDescription("");

    // Back on the first step, the review is out of reach until the contact is fixed.
    await stepper.getByRole("button", { name: "Paciente (concluída)" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(stepper.getByRole("button", { name: "Revisão" })).toHaveCount(0);
    await expect(stepper.getByRole("listitem").nth(3)).toHaveAttribute("data-locked", "true");
  });

  test("reviews exactly what it sends", async ({ page, patient: base }) => {
    const patient = {
      ...base,
      email: `${base.token}@exemplo.com`,
      address: { ...base.address, complement: "Apto 12" },
    };
    await page.goto("/cadastro/paciente");
    await fillPatientStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillContactStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await fillFinancialStep(page, patient);
    await scenarioRadio(page, "ALL_APPROVE").check();
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page).toHaveURL(/\/cadastro\/revisao$/);

    const facts = async (group: string) =>
      (
        await page
          .getByRole("region", { name: group })
          .locator("dl > div")
          .evaluateAll((items) =>
            items.map((item) => [
              item.querySelector("dt")?.textContent,
              [...(item.querySelector("dd")?.childNodes ?? [])]
                .map((node) => node.textContent)
                .join(" | "),
            ]),
          )
      ).map(([label, value]) => `${label}: ${value}`);
    expect(await facts("Paciente")).toEqual([
      `Nome completo: ${patient.fullName}`,
      `CPF: ${patient.cpfFormatted}`,
      `Data de nascimento: ${dateText(patient.birthdate)}`,
      "Endereço: Avenida Paulista, 1578 – Apto 12 | Bela Vista, São Paulo/SP | CEP 01310-100",
    ]);
    expect(await facts("Contato")).toEqual([
      "Celular: (11) 98765-4321",
      `E-mail: ${patient.email}`,
    ]);
    expect(await facts("Financeiro")).toEqual([
      `Renda mensal: R$ ${centsInput(patient.monthlyIncomeCents)}`,
      `Valor do tratamento: R$ ${centsInput(patient.treatmentAmountCents)}`,
      "Cenário de simulação: Todas aprovam",
    ]);

    // "Editar" goes to the group's step; the stepper brings the review back.
    await page.getByRole("button", { name: "Editar Contato" }).click();
    await expect(page).toHaveURL(/\/cadastro\/contato$/);
    await expect(page.getByLabel("Celular com DDD")).toBeFocused();
    await signupStepper(page).getByRole("button", { name: "Revisão", exact: true }).click();
    await page.getByRole("button", { name: "Editar Financeiro" }).click();
    await expect(page).toHaveURL(/\/cadastro\/financeiro$/);
    await expect(page.getByLabel("Renda mensal")).toBeFocused();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Editar Paciente" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(page.getByLabel("Nome completo")).toBeFocused();
    await signupStepper(page).getByRole("button", { name: "Revisão", exact: true }).click();
    await expect(page).toHaveURL(/\/cadastro\/revisao$/);

    const signup = page.waitForRequest(isSignupPost);
    await page.getByRole("button", { name: "Solicitar pré-aprovação" }).click();
    expect((await signup).postDataJSON()).toEqual(signupBody(patient, "ALL_APPROVE"));
    await expect(page).toHaveURL(CONSULTATION_URL);
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
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByRole("region", { name: "Contato" }).locator("dd").nth(1)).toHaveText(
      "Não informado",
    );

    const signup = page.waitForRequest(isSignupPost);
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
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByRole("region", { name: "Contato" })).toContainText("ana@clinica.com");
    const signup = page.waitForRequest(isSignupPost);
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

  test("keeps the calendar's month and year dropdowns open when clicked", async ({ page }) => {
    // Clicks in the portalled calendar used to bubble (through React) to the input group, which
    // focuses its input on any non-button click: the native dropdown closed as soon as it opened.
    await page.goto("/cadastro/paciente");
    await page.getByRole("button", { name: "Selecionar data" }).click();
    const calendar = page.locator("[data-slot=calendar]");
    await expect(calendar.getByRole("grid")).toBeVisible();

    for (const dropdown of await calendar.locator("select").all()) {
      await dropdown.click();
      await expect(dropdown).toBeFocused();
      await page.waitForTimeout(300);
      await expect(dropdown).toBeFocused();
      await expect(page.getByLabel("Data de nascimento")).not.toBeFocused();
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

  test("flags amounts outside the bounds", async ({ page, patient }) => {
    await reachFinancialStep(page, patient);
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

    await reachReview(page, patient);
    await expect(page.getByRole("region", { name: "Paciente" })).toContainText(patient.fullName);
    await expectNothingEntered("before reload");

    // A reload starts over: the review isn't reachable from an empty form.
    await page.reload();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
    await expect(page.getByLabel("Nome completo")).toBeVisible();
    await expectNothingEntered("after reload");
    await expect(page.getByLabel("Nome completo")).toHaveValue("");
    await expect(page.getByLabel("CPF", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Data de nascimento")).toHaveValue("");
    await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Rua")).toHaveCount(0);
  });

  test("hides the scenario picker when controls are off", async ({ page, patient }) => {
    let configServed = false;
    await page.route("**/api/config", async (route) => {
      configServed = true;
      await route.fulfill({ json: { simulationControls: false } });
    });

    await reachFinancialStep(page, patient);
    await expect(page.getByLabel("Valor do tratamento")).toBeVisible();
    expect(configServed).toBe(true);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    await expect(scenarioRadio(page, "ALL_APPROVE")).toHaveCount(0);
    await expect(page.getByText("Cenário de simulação")).toHaveCount(0);

    // Nor does the review mention it: the request leaves it out.
    await fillFinancialStep(page, patient);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByRole("region", { name: "Financeiro" })).toContainText("Renda mensal");
    await expect(page.getByText("Cenário de simulação")).toHaveCount(0);
  });
});
