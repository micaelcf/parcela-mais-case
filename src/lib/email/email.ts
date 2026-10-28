import Type from "typebox";

/**
 * The patient's e-mail (optional). Shared by the signup API, the form and storage. The shape is
 * the WHATWG `input type=email` local part plus a domain that must have a dot and a 2+ letter TLD
 * (`ana@clinica` is refused), within RFC 5321's limits: 64 characters before `@`, 254 in all.
 */

const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;
const MAX_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

export const EMAIL_MESSAGE = "Informe um e-mail válido, ex.: nome@exemplo.com";

/** What's stored and hashed: trimmed and lower-cased. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** A deliverable-looking address: one `@`, a valid local part and a dotted domain with a TLD. */
export function isEmail(input: string): boolean {
  const email = input.trim();
  if (email.length === 0 || email.length > MAX_LENGTH) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || email.indexOf("@") !== at) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split(".");
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TLD.test(labels.at(-1) ?? "");
}

/** An e-mail string, rejected with a pt-BR example of the expected shape. */
export const EmailSchema = Type.Refine(Type.String(), isEmail, () => EMAIL_MESSAGE);
