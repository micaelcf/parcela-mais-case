import Type from "typebox";

/** A CPF either bare (`52998224725`) or in the usual mask (`529.982.247-25`). */
const CPF_SHAPE = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
const BASE9_SHAPE = /^\d{9}$/;

/** Strips every non-digit. */
export function normalizeCpf(input: string): string {
  return input.replace(/\D/g, "");
}

/** Mod-11 check digit over `digits`, with weights counting down to 2 from `digits.length + 1`. */
function checkDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * (digits.length + 1 - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** The two check digits for 9 base digits. Throws when `base9` isn't exactly 9 digits. */
export function cpfCheckDigits(base9: string): string {
  if (!BASE9_SHAPE.test(base9)) throw new Error("cpfCheckDigits expects exactly 9 digits");
  const first = checkDigit(base9);
  const second = checkDigit(`${base9}${first}`);
  return `${first}${second}`;
}

/** Formatted or not: 11 digits, not all equal, and both check digits match. */
export function isValidCpf(input: string): boolean {
  const trimmed = input.trim();
  if (!CPF_SHAPE.test(trimmed)) return false;
  const digits = normalizeCpf(trimmed);
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return cpfCheckDigits(digits.slice(0, 9)) === digits.slice(9);
}

/** A CPF string, formatted or not, rejected with the pt-BR message "CPF inválido". */
export const CpfSchema = Type.Refine(Type.String(), isValidCpf, () => "CPF inválido");
