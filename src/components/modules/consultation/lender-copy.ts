import type { AttemptReason, AttemptStatus, LenderCode } from "#/lib/enums";

export const LENDER_NAME: Record<LenderCode, string> = {
  ALFA: "Alfa",
  BETA: "Beta",
  GAMA: "Gama",
  DELTA: "Delta",
};

/** The card's state word: each card shows exactly one of these. */
export const STATUS_LABEL: Record<AttemptStatus, string> = {
  PENDING: "consultando",
  APPROVED: "aprovada",
  REFUSED: "recusada",
  UNAVAILABLE: "indisponível",
};

/** Why a lender didn't approve, in non-sensitive terms: never the rule behind it. */
export const REASON_TEXT: Record<AttemptReason, string> = {
  AMOUNT_ABOVE_LIMIT: "valor acima do limite",
  PROFILE_NOT_ELIGIBLE: "perfil não elegível",
  LENDER_ERROR: "a financeira teve uma falha ao responder",
  TIMEOUT: "sem resposta dentro do prazo",
  CIRCUIT_OPEN: "fora do ar no momento",
  DISABLED: "pausada pela operação",
  INTEGRATION_ERROR: "falha de comunicação com a financeira",
};
