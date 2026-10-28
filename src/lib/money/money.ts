/**
 * Display helpers for money and rates. Values are integer cents and decimal rate strings
 * computed by the API; the browser only formats and parses what the user types.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PLAIN = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PERCENT = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** `97428` → `"R$ 974,28"` (Intl's non-breaking space after `R$` becomes a plain space). */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/[\u00a0\u202f]/g, " ");
}

/** `1000000` → `"10.000,00"`: the value shown in a currency input after it loses focus. */
export function formatCentsInput(cents: number): string {
  return PLAIN.format(cents / 100);
}

/** `"0.024900"` (monthly, decimal) → `"2,49% a.m."`. */
export function formatRate(monthlyRate: string): string {
  return `${PERCENT.format(Number(monthlyRate) * 100)}% a.m.`;
}

/** `R$ 10.000,00`, `10.000,00`, `10000,5` or `10000`: pt-BR thousands dots, optional comma cents. */
const CURRENCY_INPUT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** What the user typed in a currency input → integer cents, or null when it isn't an amount. */
export function parseCentsInput(raw: string): number | null {
  const match = CURRENCY_INPUT.exec(raw.replace(/^\s*R\$\s*/, "").trim());
  if (!match) return null;
  const reais = match[1].replaceAll(".", "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  const value = Number(`${reais}${cents}`);
  return Number.isSafeInteger(value) ? value : null;
}
