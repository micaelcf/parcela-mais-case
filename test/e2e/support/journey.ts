import type { Locator, Page } from "@playwright/test";

import type { LenderCode } from "#/lib/enums";

export const LENDERS = [
  { code: "ALFA", name: "Alfa" },
  { code: "BETA", name: "Beta" },
  { code: "GAMA", name: "Gama" },
  { code: "DELTA", name: "Delta" },
] as const satisfies ReadonlyArray<{ code: LenderCode; name: string }>;

export type LenderName = (typeof LENDERS)[number]["name"];

/** The four words a lender card shows for its state (RF-203). */
export const STATUS_WORDS = ["consultando", "aprovada", "recusada", "indisponível"] as const;

/** A lender's live card: a status region named by the lender's heading. */
export function lenderCard(page: Page, name: LenderName): Locator {
  return page.getByRole("status", { name, exact: true });
}

/** The offer rows (`li[data-lender]`), in on-screen order; optionally one lender's only. */
export function offerRows(page: Page, lender?: LenderCode): Locator {
  return page.locator(lender ? `li[data-lender="${lender}"]` : "li[data-lender]");
}

/** `"R$ 11.691,36"` → 1169136. */
export function parseBRL(text: string): number {
  const match = /R\$\s*([\d.]+),(\d{2})/.exec(text);
  if (!match) throw new Error(`No BRL amount in "${text}"`);
  return Number(match[1].replaceAll(".", "")) * 100 + Number(match[2]);
}

/** An offer row's figures as displayed: `"12x de R$ 974,28"` and `"Total R$ 11.691,36"`. */
export async function offerFigures(row: Locator) {
  const text = await row.innerText();
  const installment = /(\d+)x de (R\$\s*[\d.]+,\d{2})/.exec(text);
  const total = /Total (R\$\s*[\d.]+,\d{2})/.exec(text);
  if (!installment || !total) throw new Error(`Unexpected offer row text "${text}"`);
  return {
    termMonths: Number(installment[1]),
    installmentCents: parseBRL(installment[2]),
    totalCents: parseBRL(total[1]),
  };
}

/** One lender's collapsible group of offers. */
export function offerGroup(page: Page, lender: LenderCode): Locator {
  return page.locator(`[data-lender-group="${lender}"]`);
}

/** The button heading a lender's offer group; it collapses and expands the group. */
export function offerGroupToggle(page: Page, lender: LenderCode): Locator {
  return offerGroup(page, lender).getByRole("heading").getByRole("button");
}

/** The dialog that confirms a choice before it is sent. */
export function choiceDialog(page: Page): Locator {
  return page.getByRole("alertdialog", { name: "Confirmar a escolha desta oferta?" });
}

/** Chooses an offer by its row button's accessible name and confirms it in the dialog. */
export async function chooseOffer(page: Page, buttonName: string) {
  await page.getByRole("button", { name: buttonName }).click();
  await choiceDialog(page).getByRole("button", { name: "Confirmar escolha" }).click();
}
