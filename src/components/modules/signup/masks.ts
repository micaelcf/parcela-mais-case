import { normalizePhone } from "#/lib/phone/phone";

/** Display-only input masks: they format what's typed; validation runs on the normalised digits. */

/** `52998224725` → `529.982.247-25`, progressively while typing. */
export function maskCpf(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

/**
 * `11987654321` → `(11) 98765-4321`; ten digits → `(11) 8765-4321`. A pasted `+55`/`55` country
 * code or `0` trunk prefix is dropped first, so `+55 11 98765-4321` shows as `(11) 98765-4321`.
 */
export function maskPhone(raw: string): string {
  const digits = normalizePhone(raw).replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  const split = rest.length > 8 ? 5 : 4;
  return rest.length > split
    ? `(${area}) ${rest.slice(0, split)}-${rest.slice(split)}`
    : `(${area}) ${rest}`;
}

/** `01310100` → `01310-100`, progressively while typing. */
export function maskCep(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/** At most R$ 999.999.999: enough for any income or treatment, short of absurd input. */
const MAX_REAIS_DIGITS = 9;

/**
 * `1234567` → `1.234.567`, `1234,5` → `1.234,5`, progressively while typing (pt-BR, like the parser:
 * the comma starts the cents, at most two; thousands dots are placed here, so typed dots are
 * dropped). A pasted `R$ 10.000,00` keeps its value. Blur pads the cents (`1.234` → `1.234,00`).
 */
export function maskMoney(raw: string): string {
  const [whole = "", ...fraction] = raw.replace(/^\s*R\$\s*/, "").split(",");
  const reais = whole
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, MAX_REAIS_DIGITS);
  const grouped = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (fraction.length === 0) return grouped;
  const cents = fraction.join("").replace(/\D/g, "").slice(0, 2);
  return `${grouped || "0"},${cents}`;
}
