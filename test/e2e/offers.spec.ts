import { expect, journeyTest as test } from "./support/fixtures";
import {
  chooseOffer,
  choiceDialog,
  LENDERS,
  lenderCard,
  offerFigures,
  offerGroup,
  offerGroupToggle,
  offerRows,
} from "./support/journey";
import { signUp } from "./support/signup";

const PARTIAL_FLAG = "valor aprovado menor que o solicitado";
/** Alfa, R$ 10.000,00 at 2,49 % a.m. over 12 months (Tabela Price). */
const ALFA_12X = "Escolher Alfa em 12x de R$ 974,28";

test.describe("offers", () => {
  test("shows rate and terms", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    const alfa = offerRows(page, "ALFA");
    await expect(alfa).toHaveCount(3);

    const terms: number[] = [];
    for (const row of await alfa.all()) {
      await expect(row).toContainText("2,49% a.m.");
      terms.push((await offerFigures(row)).termMonths);
    }
    expect([...terms].sort((a, b) => a - b)).toEqual([6, 12, 18]);
  });

  test("shows Price installments and totals", async ({ page, patient }) => {
    expect(patient.treatmentAmountCents).toBe(1_000_000);
    await signUp(page, patient, "ALL_APPROVE");
    const alfa12 = page.locator('li[data-lender="ALFA"][data-term="12"]');

    await expect(alfa12).toContainText("12x de R$ 974,28");
    await expect(alfa12).toContainText("Total R$ 11.691,36");
  });

  test("flags a partial approval", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    const beta = offerRows(page, "BETA");
    const alfa = offerRows(page, "ALFA");
    await expect(beta).toHaveCount(3);
    await expect(alfa).toHaveCount(3);

    for (const row of await beta.all()) await expect(row).toContainText(PARTIAL_FLAG);
    for (const row of await alfa.all()) await expect(row).not.toContainText(PARTIAL_FLAG);

    // The confirmation repeats the flag before a partial offer is chosen.
    await beta
      .first()
      .getByRole("button", { name: /^Escolher Beta em / })
      .click();
    await expect(choiceDialog(page)).toContainText(PARTIAL_FLAG);
  });

  test("groups offers by lender", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("aprovada");

    for (const { code, name } of LENDERS) {
      await expect(lenderCard(page, name).locator(`[data-lender-logo="${code}"]`)).toBeVisible();
      const group = offerGroup(page, code);
      const toggle = offerGroupToggle(page, code);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toContainText(name);
      await expect(toggle).toContainText(/3 ofertas · a partir de \d+x de R\$/);
      await expect(toggle.locator(`[data-lender-logo="${code}"]`)).toBeVisible();
      await expect(group.locator("li[data-lender]")).toHaveCount(3);
      for (const row of await group.locator("li[data-lender]").all()) {
        await expect(row).toHaveAttribute("data-lender", code);
        await expect(row).toBeVisible();
      }
    }
  });

  test("collapses and expands a lender group", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    const alfaList = page.getByRole("list", { name: "Ofertas Alfa" });
    const toggle = offerGroupToggle(page, "ALFA");
    await expect(alfaList).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(alfaList).toBeHidden();
    await expect(page.getByRole("button", { name: ALFA_12X })).toBeHidden();
    await expect(page.getByRole("list", { name: "Ofertas Beta" })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(alfaList).toBeVisible();
    await expect(offerRows(page, "ALFA")).toHaveCount(3);
    await expect(page.getByRole("button", { name: ALFA_12X })).toBeVisible();
  });

  test("sorts offers", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("aprovada");
    const rows = offerRows(page);
    await expect(rows).toHaveCount(12);
    const figures = async () => Promise.all((await rows.all()).map((row) => offerFigures(row)));

    const byInstallment = page.getByRole("button", { name: "Menor parcela" });
    await byInstallment.click();
    await expect(byInstallment).toHaveAttribute("aria-pressed", "true");
    const installments = (await figures()).map((offer) => offer.installmentCents);
    expect(installments[0]).toBe(Math.min(...installments));

    const byTotal = page.getByRole("button", { name: "Menor custo total" });
    await byTotal.click();
    await expect(byTotal).toHaveAttribute("aria-pressed", "true");
    await expect(byInstallment).toHaveAttribute("aria-pressed", "false");
    const totals = (await figures()).map((offer) => offer.totalCents);
    expect(totals[0]).toBe(Math.min(...totals));
    // The two orders differ for this set, so the toggle visibly reorders the list.
    expect(totals[0]).not.toBe(Math.min(...installments));
  });

  test("cancels a choice without sending it", async ({ page, patient }) => {
    const choicePosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/choice")) {
        choicePosts.push(request.url());
      }
    });
    await signUp(page, patient, "ALL_APPROVE");
    const choose = page.getByRole("button", { name: ALFA_12X });
    await choose.click();

    const dialog = choiceDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-lender-logo="ALFA"]')).toBeVisible();
    await expect(dialog).toContainText("Alfa");
    await expect(dialog).toContainText("12x de R$ 974,28");
    await expect(dialog).toContainText("R$ 11.691,36");
    await expect(dialog).toContainText("2,49% a.m.");
    await expect(dialog).toContainText("R$ 10.000,00");
    await expect(dialog).toContainText("A escolha é definitiva");
    await expect(dialog).not.toContainText(PARTIAL_FLAG);

    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await expect(choose).toBeFocused();
    expect(choicePosts).toEqual([]);
    await expect(page.getByText("A escolha foi registrada")).toHaveCount(0);
    await expect(page.locator("li[data-chosen]")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: ALFA_12X })).toBeVisible();
    await expect(page.getByText("A escolha foi registrada")).toHaveCount(0);
    expect(choicePosts).toEqual([]);
  });

  test("persists the choice across reloads", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    await chooseOffer(page, ALFA_12X);

    const confirmation = page.getByRole("alert").filter({ hasText: "A escolha foi registrada" });
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
    await expect(choiceDialog(page)).toBeHidden();
    await expect(confirmation).toBeFocused();
    await page.reload();
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
    await expect(page.locator('li[data-lender="ALFA"][data-term="12"]')).toContainText("Escolhida");
    await expect(page.getByRole("button", { name: /^Escolher / })).toHaveCount(0);
  });

  test("chooses before all lenders answer", async ({ page, patient }) => {
    // Delta answers after the deadline: its card shows "consultando" for ~10 s.
    await signUp(page, patient, "DELTA_TIMES_OUT");
    const choose = page.getByRole("button", { name: ALFA_12X });
    await expect(choose).toBeVisible();
    await expect(lenderCard(page, "Delta")).toContainText("consultando");

    await chooseOffer(page, ALFA_12X);
    const confirmation = page.getByRole("alert").filter({ hasText: "A escolha foi registrada" });
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
    await expect(lenderCard(page, "Delta")).toContainText("consultando", { timeout: 1 });
  });
});
