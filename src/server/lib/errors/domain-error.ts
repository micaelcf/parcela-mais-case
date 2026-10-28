/** Every error code the API can answer with (contract `api.md` § Errors). */
export type ErrorCode =
  | "VALIDATION"
  | "IDEMPOTENCY_KEY_REUSED"
  | "SIMULATION_DISABLED"
  | "PATIENT_LIMIT"
  | "IP_LIMIT"
  | "CONSULTATION_NOT_FOUND"
  | "OFFER_NOT_FOUND"
  | "CHOICE_CONFLICT"
  | "REQUOTE_NOT_ALLOWED"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "NOT_FOUND"
  | "INTERNAL";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  SIMULATION_DISABLED: 422,
  PATIENT_LIMIT: 429,
  IP_LIMIT: 429,
  CONSULTATION_NOT_FOUND: 404,
  OFFER_NOT_FOUND: 404,
  CHOICE_CONFLICT: 409,
  REQUOTE_NOT_ALLOWED: 409,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export type FieldError = { path: string; message: string };

/** A business or request failure that maps to one problem+json response. */
export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly detail: string,
    readonly fields?: FieldError[],
  ) {
    super(detail);
    this.name = "DomainError";
    this.status = ERROR_STATUS[code];
  }
}
