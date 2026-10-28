import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { AddressLookupSchema } from "#/lib/address/address";
import { ScenarioSchema } from "#/server/modules/consultation/consultation.dto";

/**
 * The signup draft (RFC D34): what this tab typed, kept in `sessionStorage` so a reload doesn't
 * lose it. Never `localStorage`; never the idempotency key (one per page load, so a duplicated tab
 * that copies the draft still sends its own request). It expires 30 minutes after the last edit
 * (saving it again, e.g. when the page goes away, doesn't extend it), and is discarded once a
 * signup is sent or a new one is started.
 */
export const SIGNUP_DRAFT_KEY = "parcela:signup-draft";
export const SIGNUP_DRAFT_TTL_MS = 30 * 60 * 1000;

const text = Type.String({ maxLength: 512 });

/** The form's values as typed: shape only, since a draft may hold half-typed, invalid values. */
const DraftValuesSchema = Type.Object({
  fullName: text,
  cpf: text,
  birthdate: text,
  cep: text,
  street: text,
  addressNumber: text,
  complement: Type.Optional(text),
  neighborhood: text,
  city: text,
  state: text,
  phone: text,
  email: text,
  monthlyIncome: text,
  treatmentAmount: text,
  simulationScenario: ScenarioSchema,
});

/** The CEP lookup that filled the address, so a restore neither repeats it nor refills the fields. */
const DraftLookupSchema = Type.Object({
  cep: Type.String(),
  result: Type.Union([
    Type.Object({ kind: Type.Literal("found"), address: AddressLookupSchema }),
    Type.Object({ kind: Type.Literal("not_found") }),
    Type.Object({ kind: Type.Literal("invalid") }),
    Type.Object({ kind: Type.Literal("unavailable") }),
  ]),
});
export type SignupDraftLookup = Static<typeof DraftLookupSchema>;

const SignupDraftSchema = Type.Object({
  version: Type.Literal(1),
  /** When a value last changed (ms since the epoch): the 30 minutes count from here. */
  editedAt: Type.Number(),
  values: DraftValuesSchema,
  cepLookup: Type.Union([DraftLookupSchema, Type.Null()]),
});
export type SignupDraft = Static<typeof SignupDraftSchema>;

const draftValidator = Compile(SignupDraftSchema);

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The stored draft, or null; an unreadable, malformed or expired one is removed. */
export function readSignupDraft(storage: DraftStorage, now: number): SignupDraft | null {
  const raw = storage.getItem(SIGNUP_DRAFT_KEY);
  if (raw === null) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Falls through to the removal below.
  }
  if (draftValidator.Check(parsed) && now - parsed.editedAt <= SIGNUP_DRAFT_TTL_MS) return parsed;
  storage.removeItem(SIGNUP_DRAFT_KEY);
  return null;
}

/** What a save holds: the values, the lookup behind the address, and when a value last changed. */
export type SignupDraftContent = Omit<SignupDraft, "version">;

export function writeSignupDraft(storage: DraftStorage, draft: SignupDraftContent): void {
  const stored: SignupDraft = { version: 1, ...draft };
  storage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(stored));
}

/** This tab's session storage, or null where the browser refuses it (then nothing is kept). */
function sessionStore(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSignupDraft(): SignupDraft | null {
  const storage = sessionStore();
  try {
    return storage ? readSignupDraft(storage, Date.now()) : null;
  } catch {
    return null;
  }
}

export function saveSignupDraft(draft: SignupDraftContent): void {
  const storage = sessionStore();
  try {
    if (storage) writeSignupDraft(storage, draft);
  } catch {
    // Quota or a storage refused mid-session: the form still works, it just won't survive a reload.
  }
}

export function discardSignupDraft(): void {
  try {
    sessionStore()?.removeItem(SIGNUP_DRAFT_KEY);
  } catch {
    // Nothing stored where storage is refused.
  }
}
