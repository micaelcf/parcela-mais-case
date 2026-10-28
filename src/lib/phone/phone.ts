import Type from "typebox";

/**
 * Brazilian mobile numbers (Anatel numbering plan): a 2-digit area code (DDD) from the national
 * list, then `9` and 8 more digits, 11 national digits in all (`11 98765-4321`). Landlines have 8
 * local digits starting with 2–5 and aren't accepted: the clinic contacts the patient by mobile.
 */

/** The 67 area codes (DDD) in use. */
const AREA_CODES: ReadonlySet<string> = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "53",
  "54",
  "55",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "69",
  "71",
  "73",
  "74",
  "75",
  "77",
  "79",
  "81",
  "82",
  "83",
  "84",
  "85",
  "86",
  "87",
  "88",
  "89",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
]);

/** Characters a typed or pasted number may carry besides digits. */
const PHONE_CHARS = /^[\d\s()+.-]+$/;
const COUNTRY_CODE = "55";
const LANDLINE_LOCAL = /^[2-5]\d{7}$/;
const MOBILE_LOCAL = /^9\d{8}$/;

/**
 * The national digits of `input`: formatting removed, then a country code dropped (`+55`, or `55`
 * in front of a 10- or 11-digit number) or a `0` trunk prefix. `+55 (11) 98765-4321` →
 * `11987654321`. Another country code is kept, so it never reads as a Brazilian number.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  const international = input.trim().startsWith("+");
  if (international) return digits.startsWith(COUNTRY_CODE) ? digits.slice(2) : `+${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith(COUNTRY_CODE)) {
    return digits.slice(2);
  }
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

export type PhoneIssue = "INVALID" | "AREA_CODE" | "LANDLINE" | "NOT_MOBILE";

/** Why `input` isn't a Brazilian mobile number, or null when it is one. */
export function phoneIssue(input: string): PhoneIssue | null {
  if (!PHONE_CHARS.test(input.trim())) return "INVALID";
  const digits = normalizePhone(input);
  if (!/^\d{10,11}$/.test(digits)) return "INVALID";
  if (!AREA_CODES.has(digits.slice(0, 2))) return "AREA_CODE";
  const local = digits.slice(2);
  if (LANDLINE_LOCAL.test(local)) return "LANDLINE";
  return MOBILE_LOCAL.test(local) ? null : "NOT_MOBILE";
}

const PHONE_MESSAGES: Record<PhoneIssue, string> = {
  INVALID: "Informe o celular com DDD, ex.: (11) 98765-4321",
  AREA_CODE: "DDD inválido",
  LANDLINE: "Informe um celular; telefone fixo não é aceito",
  NOT_MOBILE: "O celular deve ter 9 dígitos começando com 9 depois do DDD",
};

/** A Brazilian mobile number, formatted or not, with a pt-BR message naming what's wrong. */
export const PhoneSchema = Type.Refine(
  Type.String(),
  (value) => phoneIssue(value) === null,
  (value) => PHONE_MESSAGES[phoneIssue(value) ?? "INVALID"],
);
