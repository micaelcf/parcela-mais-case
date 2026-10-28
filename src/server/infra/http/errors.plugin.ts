import { Elysia, ElysiaStatus, NotFound, ParseError, ValidationError } from "elysia";
import type { TSchema } from "typebox";

import { collectIssues } from "#/lib/validation/standard-schema";
import { DomainError, type ErrorCode, type FieldError } from "#/server/lib/errors/domain-error";
import { logger } from "#/server/lib/log/logger";

const TITLES: Record<ErrorCode, string> = {
  VALIDATION: "Dados inválidos",
  IDEMPOTENCY_KEY_REUSED: "Chave de idempotência já usada com outros dados",
  SIMULATION_DISABLED: "Cenários de simulação desativados",
  PATIENT_LIMIT: "Limite de consultas do paciente atingido",
  IP_LIMIT: "Muitas requisições",
  CONSULTATION_NOT_FOUND: "Consulta não encontrada",
  OFFER_NOT_FOUND: "Oferta não encontrada",
  CHOICE_CONFLICT: "Outra oferta já foi escolhida",
  REQUOTE_NOT_ALLOWED: "Nova simulação não permitida",
  UNAUTHENTICATED: "Sessão inválida",
  INVALID_CREDENTIALS: "Usuário ou senha inválidos",
  NOT_FOUND: "Recurso não encontrado",
  INTERNAL: "Erro interno",
};

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  fields?: FieldError[];
};

export function problem(error: DomainError): Response {
  const body: ProblemBody = {
    type: `urn:parcela:error:${error.code.toLowerCase()}`,
    title: TITLES[error.code],
    status: error.status,
    code: error.code,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(error.fields ? { fields: error.fields } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: { "content-type": "application/problem+json" },
  });
}

function validationFields(error: ValidationError): FieldError[] {
  const schema = error.schema;
  if (schema && typeof schema === "object") {
    // The schema Elysia validated with keeps its refinements; re-running it yields every
    // field issue with our pt-BR messages, in every NODE_ENV (Elysia hides them in production).
    const issues = collectIssues(schema as TSchema, error.value);
    if (issues.length > 0) {
      return issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    }
  }
  return [{ path: error.type ?? "", message: "Valor inválido" }];
}

/** Elysia 2 throws a 415 status (not an Error) when the body's content type has no JSON parser. */
export function isUnsupportedMediaType(error: unknown): boolean {
  return error instanceof ElysiaStatus && error.status === 415;
}

/** Body content types Elysia parses into an object (JSON, form-encoded, multipart). */
const PARSED_BODY_TYPE =
  /^(application\/(.+\+)?json|application\/x-www-form-urlencoded|multipart\/form-data)\b/i;

/**
 * A body sent with a content type Elysia doesn't parse. Without a route `parse` hook Elysia throws
 * its 415; with one (throttle, backoffice guard) it skips that check and the body fails validation
 * as a whole. Both must answer the same.
 */
function hasUnparsedBody(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType !== null && contentType !== "" && !PARSED_BODY_TYPE.test(contentType);
}

const NOT_JSON = "Envie o corpo como JSON (Content-Type: application/json).";

/** Name and message of anything thrown; Elysia also throws plain status objects. */
function describeThrown(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  const name = (typeof error === "object" && error?.constructor?.name) || typeof error;
  let message: string;
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { name, message };
}

/** Maps every thrown error to one RFC 9457 problem+json response (contract `api.md` § Errors). */
export const errorsPlugin = new Elysia({ name: "errors" }).onError(
  "global",
  ({ error, request }) => {
    if (error instanceof DomainError) return problem(error);
    if (isUnsupportedMediaType(error)) return problem(new DomainError("VALIDATION", NOT_JSON));
    if (error instanceof ValidationError && error.status === 422) {
      if (hasUnparsedBody(request)) return problem(new DomainError("VALIDATION", NOT_JSON));
      const fields = validationFields(error);
      return problem(new DomainError("VALIDATION", "Verifique os campos destacados.", fields));
    }
    if (error instanceof NotFound) return problem(new DomainError("NOT_FOUND", ""));
    if (error instanceof ParseError) {
      return problem(new DomainError("VALIDATION", "O corpo da requisição não é um JSON válido."));
    }
    logger.error("http.unhandled_error", describeThrown(error));
    return problem(new DomainError("INTERNAL", ""));
  },
);
