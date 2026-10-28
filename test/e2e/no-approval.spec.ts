import { expect, journeyTest as test } from "./support/fixtures";
import { LENDERS, lenderCard } from "./support/journey";
import { CONSULTATION_URL, signUp } from "./support/signup";

/** Rule internals the public screen must never reveal (RF-301). */
const RULE_INTERNALS = ["renda", "10x", "idade", "25 anos", "20.000"];
const OUTCOME_TEXTS = ["valor acima do limite", "perfil não elegível", "indisponível"];

test.describe("no approval", () => {
  test("explains each lender without rule internals", async ({ page, patient }) => {
    await signUp(page, patient, "NONE_APPROVE");
    for (const { name } of LENDERS) await expect(lenderCard(page, name)).toContainText("recusada");

    for (const { name } of LENDERS) {
      const text = await lenderCard(page, name).innerText();
      expect(
        OUTCOME_TEXTS.some((outcome) => text.includes(outcome)),
        `${name} card: "${text}"`,
      ).toBe(true);
    }
    await expect(page.getByRole("heading", { name: /^Nenhuma financeira aprovou/ })).toBeVisible();
    const pageText = (await page.locator("body").innerText()).toLowerCase();
    for (const internal of RULE_INTERNALS) expect(pageText).not.toContain(internal);
  });

  test("suggests the hinted amount", async ({ page, patient }) => {
    expect(patient.treatmentAmountCents).toBe(1_000_000);
    await signUp(page, patient, "NONE_APPROVE");

    // Alfa hints it could approve half of the R$ 10.000,00 asked for.
    await expect(page.getByText(/Sugestão: simular com R\$ 5\.000,00/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Simular com R$ 5.000,00" })).toBeVisible();
  });

  test("requotes with the suggested amount", async ({ page, patient }) => {
    const sourceId = await signUp(page, patient, "NONE_APPROVE");
    const requote = page.getByRole("button", { name: "Simular com R$ 5.000,00" });
    await requote.click();

    await expect(page).not.toHaveURL(new RegExp(`/consultas/${sourceId}$`));
    await expect(page).toHaveURL(CONSULTATION_URL);
    const requotedId = CONSULTATION_URL.exec(page.url())![1];
    expect(requotedId).not.toBe(sourceId);
    await expect(page.getByText(/valor solicitado\s+R\$ 5\.000,00/)).toBeVisible();
  });
});
