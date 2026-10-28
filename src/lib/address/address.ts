import Type, { type Static } from "typebox";

/**
 * A Brazilian postal address, shared by the signup API, the form and the CEP lookup. The CEP
 * (8 digits, `01310-100`) is looked up through `GET /api/addresses/:cep` (ViaCEP behind it); the
 * other fields are prefilled from that answer and edited by the user.
 */

/** The 27 federative units (UF), alphabetically. */
export const BR_STATES = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;
export type BrState = (typeof BR_STATES)[number];

/** A CEP either bare (`01310100`) or masked (`01310-100`). */
const CEP_SHAPE = /^\d{5}-?\d{3}$/;

/** Strips every non-digit. */
export function normalizeCep(input: string): string {
  return input.replace(/\D/g, "");
}

/** 8 digits, masked or not, not all zeros (no CEP starts with `00000`). */
export function isCep(input: string): boolean {
  const trimmed = input.trim();
  return CEP_SHAPE.test(trimmed) && !normalizeCep(trimmed).startsWith("00000");
}

export const CEP_MESSAGE = "CEP inválido";

/** A CEP string, masked or not, rejected with "CEP inválido". */
export const CepSchema = Type.Refine(Type.String(), isCep, () => CEP_MESSAGE);

/** Non-blank text of at most `maxLength` characters, with a field-specific pt-BR message. */
function requiredText(maxLength: number, message: string) {
  return Type.Refine(
    Type.String({ maxLength }),
    (value) => value.trim().length > 0,
    () => message,
  );
}

export const AddressSchema = Type.Object({
  cep: CepSchema,
  street: requiredText(120, "Informe a rua"),
  /** House number as written: `123`, `123A`, `S/N`. */
  number: requiredText(10, "Informe o número (ou S/N)"),
  complement: Type.Optional(Type.String({ maxLength: 60 })),
  neighborhood: requiredText(80, "Informe o bairro"),
  city: requiredText(80, "Informe a cidade"),
  state: Type.Enum(BR_STATES, { error: "Selecione a UF" }),
});
export type Address = Static<typeof AddressSchema>;

/** What's stored and hashed: CEP digits, trimmed text, an empty complement dropped. */
export function normalizeAddress(address: Address): Address {
  const complement = address.complement?.trim();
  return {
    cep: normalizeCep(address.cep),
    street: address.street.trim(),
    number: address.number.trim(),
    ...(complement ? { complement } : {}),
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state,
  };
}

/** `GET /api/addresses/:cep` → 200 body: what ViaCEP knows (street/neighborhood may be empty). */
export const AddressLookupSchema = Type.Object({
  cep: Type.String(),
  street: Type.String(),
  neighborhood: Type.String(),
  city: Type.String(),
  state: Type.Enum(BR_STATES),
});
export type AddressLookup = Static<typeof AddressLookupSchema>;
