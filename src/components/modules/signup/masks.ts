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
