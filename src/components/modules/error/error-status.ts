import { ApiError } from "#/api/eden";

/** What an error page says for one status, and whether trying again can help. */
export type ErrorCopy = { title: string; description: string; retryable: boolean };

const SERVER_DOWN: ErrorCopy = {
  title: "Serviço indisponível",
  description: "Não conseguimos falar com o servidor agora. Verifique sua conexão e tente de novo.",
  retryable: true,
};

const SERVER_FAULT: ErrorCopy = {
  title: "Algo deu errado do nosso lado",
  description: "Não foi nada que você fez. Tente de novo em instantes.",
  retryable: true,
};

const CLIENT_FAULT: ErrorCopy = {
  title: "Não foi possível abrir esta página",
  description: "O endereço ou os dados enviados não são válidos.",
  retryable: false,
};

const COPY: Partial<Record<number, ErrorCopy>> = {
  403: {
    title: "Acesso negado",
    description: "Esta página não está disponível para você.",
    retryable: false,
  },
  404: {
    title: "Página não encontrada",
    description: "O endereço pode estar incompleto, ou a página não existe mais.",
    retryable: false,
  },
  408: {
    title: "A resposta demorou demais",
    description: "O servidor não respondeu a tempo. Tente de novo.",
    retryable: true,
  },
  429: {
    title: "Muitas tentativas seguidas",
    description: "Por segurança, há um limite de consultas. Aguarde um pouco e tente de novo.",
    retryable: true,
  },
  500: SERVER_FAULT,
  502: SERVER_DOWN,
  503: SERVER_DOWN,
  504: SERVER_DOWN,
};

/**
 * The status an error page shows: the API's own; 503 when the server couldn't be reached at all;
 * 500 for anything else (a fault in the page itself).
 */
export function errorStatusOf(error: unknown): number {
  if (!(error instanceof ApiError)) return 500;
  return error.problem.status >= 400 ? error.problem.status : 503;
}

export function errorCopyOf(status: number): ErrorCopy {
  return COPY[status] ?? (status >= 500 ? SERVER_FAULT : CLIENT_FAULT);
}
