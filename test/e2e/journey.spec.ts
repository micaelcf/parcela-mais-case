import type { Locator, Page } from "@playwright/test";

import { expect, journeyTest as test } from "./support/fixtures";
import { LENDERS, lenderCard, type LenderName, STATUS_WORDS } from "./support/journey";
import { signUp } from "./support/signup";

/** The one state word a card shows; fails when it shows none or several. */
async function statusWordOf(card: Locator): Promise<(typeof STATUS_WORDS)[number]> {
  const text = await card.innerText();
  const shown = STATUS_WORDS.filter((word) => text.includes(word));
  expect(shown, `card text "${text}"`).toHaveLength(1);
  return shown[0];
}

async function statusWords(page: Page): Promise<Record<LenderName, string>> {
  const words = {} as Record<LenderName, string>;
  for (const { name } of LENDERS) words[name] = await statusWordOf(lenderCard(page, name));
  return words;
}

test.describe("consultation page", () => {
  test("shows four lender cards", async ({ page, patient }) => {
    await signUp(page, patient, "DELTA_FAILS");

    const cards = page.getByRole("status", { name: /^(Alfa|Beta|Gama|Delta)$/ });
    await expect(cards).toHaveCount(4);
    await statusWords(page);

    // Settled: Alfa, Beta and Gama approve this patient; Delta's forced failure is "indisponível".
    for (const name of ["Alfa", "Beta", "Gama"] as const) {
      await expect(lenderCard(page, name)).toContainText("aprovada");
    }
    await expect(lenderCard(page, "Delta")).toContainText("indisponível");
    await expect(cards).toHaveCount(4);
    expect(await statusWords(page)).toEqual({
      Alfa: "aprovada",
      Beta: "aprovada",
      Gama: "aprovada",
      Delta: "indisponível",
    });
  });

  test("updates cards live", async ({ page, patient }) => {
    await signUp(page, patient, "NORMAL");
    const url = page.url();
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    // A marker on this document: a reload (or full navigation) would drop it.
    await page.evaluate(() => document.documentElement.setAttribute("data-e2e-same-document", ""));
    await expect(lenderCard(page, "Delta")).toContainText("consultando");

    await expect(lenderCard(page, "Alfa")).not.toContainText("consultando", { timeout: 9_000 });
    await expect(lenderCard(page, "Delta")).toContainText("consultando", { timeout: 1 });

    expect(navigations).toEqual([]);
    expect(page.url()).toBe(url);
    await expect(page.locator("html")).toHaveAttribute("data-e2e-same-document", "");
  });

  test("restores state on reload", async ({ page, patient }) => {
    // Delta answers after the 10 s deadline: the page stays mid-consultation for ~10 s.
    await signUp(page, patient, "DELTA_TIMES_OUT");
    for (const name of ["Alfa", "Beta", "Gama"] as const) {
      await expect(lenderCard(page, name)).not.toContainText("consultando", { timeout: 9_000 });
    }
    await expect(lenderCard(page, "Delta")).toContainText("consultando", { timeout: 1 });
    const before = await statusWords(page);

    await page.reload();
    await expect(page.getByRole("status", { name: /^(Alfa|Beta|Gama|Delta)$/ })).toHaveCount(4);
    expect(await statusWords(page)).toEqual(before);

    // Still live after the reload: Delta's card moves on when the deadline passes.
    await expect(lenderCard(page, "Delta")).toContainText("indisponível");
    await expect(lenderCard(page, "Delta")).toContainText("sem resposta dentro do prazo");
  });
});
