import type { TValidationError } from "typebox/error";
import { Locale } from "typebox/system";

export const REQUIRED_MESSAGE = "Campo obrigatório";

type Keyword = TValidationError["keyword"];
type ErrorOf<K extends Keyword> = Extract<TValidationError, { keyword: K }>;
type MessageTable = { readonly [K in Keyword]?: (error: ErrorOf<K>) => string };

/**
 * pt-BR messages per TypeBox keyword. Keywords not listed fall back to TypeBox's own pt_BR
 * locale. Domain fields override these with an `error` annotation on the schema node.
 */
const MESSAGES: MessageTable = {
  required: () => REQUIRED_MESSAGE,
  type: () => "Valor inválido",
  minLength: (error) => `Deve ter pelo menos ${error.params.limit} caracteres`,
  maxLength: (error) => `Deve ter no máximo ${error.params.limit} caracteres`,
  minimum: (error) => `Deve ser no mínimo ${error.params.limit}`,
  exclusiveMinimum: (error) => `Deve ser maior que ${error.params.limit}`,
  maximum: (error) => `Deve ser no máximo ${error.params.limit}`,
  exclusiveMaximum: (error) => `Deve ser menor que ${error.params.limit}`,
  pattern: () => "Formato inválido",
  format: () => "Formato inválido",
  enum: () => "Opção inválida",
  const: () => "Opção inválida",
  anyOf: () => "Opção inválida",
  oneOf: () => "Opção inválida",
  additionalProperties: () => "Campo não permitido",
  "~refine": (error) => error.params.message,
};

export function messageFor<K extends Keyword>(error: ErrorOf<K>): string {
  // The table is keyed by the same keyword that discriminates `error`.
  const format = MESSAGES[error.keyword];
  return format ? format(error) : Locale.pt_BR(error);
}

Locale.Set(messageFor);
