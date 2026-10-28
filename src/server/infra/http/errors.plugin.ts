import { Elysia, NotFound, ValidationError } from "elysia";
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

/** Maps every thrown error to one RFC 9457 problem+json response (contract `api.md` § Errors). */
export const errorsPlugin = new Elysia({ name: "errors" }).onError("global", ({ error }) => {
  if (error instanceof DomainError) return problem(error);
  if (error instanceof ValidationError && error.status === 422) {
    const fields = validationFields(error);
    return problem(new DomainError("VALIDATION", "Verifique os campos destacados.", fields));
  }
  if (error instanceof NotFound) return problem(new DomainError("NOT_FOUND", ""));
  logger.error("http.unhandled_error", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  return problem(new DomainError("INTERNAL", ""));
});
