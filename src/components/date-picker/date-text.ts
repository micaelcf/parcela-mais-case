/**
 * A calendar day as typed (`dd/mm/aaaa`) and as stored (ISO `YYYY-MM-DD`). Dates are local
 * calendar days: no time zone ever shifts them.
 */

const DATE_TEXT = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `17051990` → `17/05/1990`, progressively while typing; anything but digits is dropped. */
export function maskDateText(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

/** The local date of a real day (year ≥ 1), or undefined (`31/02` doesn't roll into March). */
function realDate(year: number, month: number, day: number): Date | undefined {
  if (year < 1) return undefined;
  const date = new Date(year, month - 1, day);
  date.setFullYear(year); // years below 100 would otherwise mean 19xx
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

/** A local date → `YYYY-MM-DD`. */
export function isoFromDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` → the local date at midnight, or undefined when it isn't a real day. */
export function dateFromIso(iso: string): Date | undefined {
  const match = ISO_DATE.exec(iso);
  return match ? realDate(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
}

/** `17/05/1990` → `1990-05-17`; null while incomplete or for an impossible day. */
export function isoFromDateText(text: string): string | null {
  const match = DATE_TEXT.exec(text);
  const date = match ? realDate(Number(match[3]), Number(match[2]), Number(match[1])) : undefined;
  return date ? isoFromDate(date) : null;
}

/** `1990-05-17` → `17/05/1990`; empty for anything that isn't a real ISO day. */
export function dateTextFromIso(iso: string): string {
  const date = dateFromIso(iso);
  if (!date) return "";
  const [year, month, day] = isoFromDate(date).split("-");
  return `${day}/${month}/${year}`;
}
