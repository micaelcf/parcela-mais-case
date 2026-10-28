import { expect, journeyTest as test } from "./support/fixtures";
import { LENDERS, lenderCard, offerFigures, offerRows } from "./support/journey";
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

  test("persists the choice across reloads", async ({ page, patient }) => {
    await signUp(page, patient, "ALL_APPROVE");
    await page.getByRole("button", { name: ALFA_12X }).click();

    const confirmation = page.getByRole("alert").filter({ hasText: "A escolha foi registrada" });
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
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

    await choose.click();
    const confirmation = page.getByRole("alert").filter({ hasText: "A escolha foi registrada" });
    await expect(confirmation).toContainText("Alfa · 12x de R$ 974,28");
    await expect(lenderCard(page, "Delta")).toContainText("consultando", { timeout: 1 });
  });
});
