import type { Locator, Page } from "@playwright/test";

import { expect, journeyTest as test } from "./support/fixtures";
import { LENDERS, lenderCard } from "./support/journey";
import { dateText } from "./support/patient";
import { CONSULTATION_URL, scenarioRadio, signUp } from "./support/signup";

/**
 * Describes the focused element and whether it shows a visible focus indicator: an outline that
 * isn't `none`, or a ring (a box-shadow layer with a positive spread and a visible colour; plain
 * elevation shadows have no spread). Runs in the page.
 */
function focusIndicator(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "nothing focused";
  const style = getComputedStyle(element);
  const label = `<${element.tagName.toLowerCase()}> "${(element.textContent ?? "").trim().slice(0, 40)}"`;
  const visibleColour = (colour: string) => {
    if (colour === "" || colour === "transparent") return false;
    const alpha =
      /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(colour)?.[1] ??
      /\/\s*([\d.]+)\)/.exec(colour)?.[1] ??
      "1";
    return Number(alpha) > 0;
  };
  if (
    style.outlineStyle !== "none" &&
    Number.parseFloat(style.outlineWidth) > 0 &&
    visibleColour(style.outlineColor)
  ) {
    return "visible";
  }
  const ring = style.boxShadow
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .some((layer) => {
      const colour =
        /rgba?\([^)]*\)|#[0-9a-f]+|oklch\([^)]*\)|oklab\([^)]*\)/i.exec(layer)?.[0] ?? "";
      const lengths = layer.replace(colour, "").match(/-?[\d.]+px/g) ?? [];
      return lengths.length >= 4 && Number.parseFloat(lengths[3]) > 0 && visibleColour(colour);
    });
  return ring ? "visible" : `no focus indicator on ${label} (box-shadow: ${style.boxShadow})`;
}

async function expectVisibleFocus(page: Page) {
  await expect.poll(() => page.evaluate(focusIndicator), { timeout: 2_000 }).toBe("visible");
}

/** Presses Tab until `target` has focus, checking every control focused on the way. */
async function tabTo(page: Page, target: Locator, maxTabs = 30) {
  for (let presses = 0; presses < maxTabs; presses++) {
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`${target.toString()} not reached after ${maxTabs} Tab presses`);
}

test.describe("accessibility", () => {
  test("picks the birthdate from the calendar by keyboard", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    const birthdate = page.getByLabel("Data de nascimento");
    const opener = page.getByRole("button", { name: "Abrir calendário" });
    const focusedDay = () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-day") ?? null);
    await expect(birthdate).toBeVisible();
    await tabTo(page, opener);

    await page.keyboard.press("Enter");
    const calendar = page.getByRole("dialog");
    await expect(calendar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(calendar).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(calendar).toBeVisible();
    // Tab past the month/year pickers and the arrows into the grid, then one day on.
    for (let presses = 0; presses < 8 && (await focusedDay()) === null; presses++) {
      await page.keyboard.press("Tab");
      await expectVisibleFocus(page);
    }
    const first = await focusedDay();
    expect(first, "a day of the grid takes focus").not.toBeNull();
    await page.keyboard.press("ArrowRight");
    await expect.poll(focusedDay).not.toBe(first);
    const picked = await focusedDay();
    await page.keyboard.press("Enter");

    await expect(calendar).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(birthdate).toHaveValue(picked ?? "");
  });

  test("completes the journey by keyboard", async ({ page, patient }) => {
    await page.goto("/cadastro/paciente");
    await expect(page.getByLabel("Nome completo")).toBeVisible();

    await tabTo(page, page.getByLabel("Nome completo"));
    await page.keyboard.type(patient.fullName);
    await tabTo(page, page.getByLabel("CPF", { exact: true }));
    await page.keyboard.type(patient.cpf);
    await tabTo(page, page.getByLabel("Data de nascimento"));
    const [year, month, day] = patient.birthdate.split("-");
    await page.keyboard.type(`${day}${month}${year}`);
    await expect(page.getByLabel("Data de nascimento")).toHaveValue(dateText(patient.birthdate));
    await tabTo(page, page.getByLabel("CEP", { exact: true }));
    await page.keyboard.type(patient.address.cep);
    // The looked-up address fills in and focus moves on to the number.
    const number = page.getByLabel("Número");
    await expect(number).toBeFocused();
    await expectVisibleFocus(page);
    await expect(page.getByLabel("Rua")).toHaveValue(patient.address.street);
    await page.keyboard.type(patient.address.number);
    await tabTo(page, page.getByRole("button", { name: "Próximo" }));
    await page.keyboard.press("Enter");

    const phone = page.getByLabel("Celular com DDD");
    await expect(phone).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.type(patient.phone);
    await tabTo(page, page.getByRole("button", { name: "Próximo" }));
    await page.keyboard.press("Enter");

    const income = page.getByLabel("Renda mensal");
    await expect(income).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.type("5000,00");
    await tabTo(page, page.getByLabel("Valor do tratamento"));
    await page.keyboard.type("10000,00");
    await tabTo(page, scenarioRadio(page, "NORMAL"));
    await page.keyboard.press("ArrowRight");
    const allApprove = scenarioRadio(page, "ALL_APPROVE");
    await expect(allApprove).toBeFocused();
    await expect(allApprove).toBeChecked();
    await expectVisibleFocus(page);
    await tabTo(page, page.getByRole("button", { name: "Solicitar pré-aprovação" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(CONSULTATION_URL);

    // Every lender settles (ALL_APPROVE), so the tab order no longer changes under the keyboard.
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("aprovada");
    await tabTo(page, page.getByRole("button", { name: "Escolher Alfa em 12x de R$ 974,28" }));
    await page.keyboard.press("Enter");

    const confirmation = page.getByRole("alert").filter({ hasText: "A escolha foi registrada" });
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
    await expect(confirmation).toBeFocused();
    await expectVisibleFocus(page);
  });

  test("announces lender status changes", async ({ page, patient }) => {
    // Records every text each lender card shows, from its first render on.
    await page.addInitScript(() => {
      const seen: Record<string, string[]> = {};
      Object.assign(window, { e2eLenderTexts: seen });
      const record = () => {
        for (const card of document.querySelectorAll<HTMLElement>("[role=status][data-lender]")) {
          const lender = card.dataset.lender ?? "";
          const texts = (seen[lender] ??= []);
          const text = card.textContent ?? "";
          if (texts.at(-1) !== text) texts.push(text);
        }
      };
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    await signUp(page, patient, "ALL_APPROVE");

    for (const { name } of LENDERS) {
      const card = lenderCard(page, name);
      await expect(card).toHaveAttribute("role", "status");
      await expect(card).toHaveAttribute("aria-live", "polite");
      await expect(card).toContainText("aprovada");
    }
    const texts: Record<string, string[]> = await page.evaluate(() =>
      Reflect.get(window, "e2eLenderTexts"),
    );
    for (const { code, name } of LENDERS) {
      const shown = texts[code] ?? [];
      expect(shown.length, `${name} texts: ${JSON.stringify(shown)}`).toBeGreaterThanOrEqual(2);
      expect(shown[0], name).toContain("consultando");
      expect(shown.at(-1), name).toContain("aprovada");
      expect(shown.at(-1), name).not.toContain("consultando");
    }
  });
});
