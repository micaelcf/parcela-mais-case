import { redirect } from "@tanstack/react-router";

import type { LenderCode } from "#/lib/enums";
import type { ListResponse } from "#/lib/list/list-contract";
import type {
  AbuseMetrics,
  ConsultationDetail,
  ConsultationListItem,
  LenderMetrics,
  LenderState,
  LoginRequest,
  MetricsRangeQuery,
  PipelineMetrics,
  PipelineQuery,
  SearchByCpfRequest,
  Session,
  SwitchLogItem,
  ThrottleEventItem,
} from "#/server/modules/backoffice/backoffice.dto";

import { api, type Result, toProblem, toResult } from "./eden";

const backoffice = api.backoffice;

type EdenResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { status: unknown; value: unknown } };

/** A list endpoint's query (`api.md` § List contract): paging, sort, `q` and top-level filters. */
type ListParams = Readonly<Record<string, string | number>>;

/** A read for a loader: the body, a redirect to the login page on 401, a thrown error otherwise. */
async function read<T>(call: () => Promise<EdenResponse<T>>): Promise<T> {
  const { data, error } = await call();
  if (!error) return data;
  const problem = toProblem(error);
  if (problem.status === 401) throw redirect({ to: "/backoffice/login" });
  throw new Error(problem.title);
}

/** Lender code → the URL segment of `PUT /backoffice/lenders/:lender/switch`. */
const LENDER_SLUG: Record<LenderCode, "alfa" | "beta" | "gama" | "delta"> = {
  ALFA: "alfa",
  BETA: "beta",
  GAMA: "gama",
  DELTA: "delta",
};

/** The signed-in operator, or null without a valid session. */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await backoffice.session.get();
  if (!error) return data;
  const problem = toProblem(error);
  if (problem.status === 401) return null;
  throw new Error(problem.title);
}

export function login(body: LoginRequest): Promise<Result<unknown>> {
  return toResult(() => backoffice.session.post(body));
}

export function logout(): Promise<Result<unknown>> {
  return toResult(() => backoffice.session.delete());
}

export function getPipelineMetrics(query: PipelineQuery): Promise<PipelineMetrics> {
  return read(() => backoffice.metrics.pipeline.get({ query }));
}

export function getLenderMetrics(query: MetricsRangeQuery = {}): Promise<LenderMetrics> {
  return read(() => backoffice.metrics.lenders.get({ query }));
}

export function getAbuseMetrics(query: MetricsRangeQuery = {}): Promise<AbuseMetrics> {
  return read(() => backoffice.metrics.abuse.get({ query }));
}

export function setLenderEnabled(
  lender: LenderCode,
  enabled: boolean,
): Promise<Result<LenderState>> {
  return toResult(() =>
    backoffice.lenders({ lender: LENDER_SLUG[lender] }).switch.put({ enabled }),
  );
}

export function listSwitchLog(query: ListParams): Promise<ListResponse<SwitchLogItem>> {
  return read(() => backoffice.lenders["switch-log"].get({ query }));
}

export function listConsultations(query: ListParams): Promise<ListResponse<ConsultationListItem>> {
  return read(() => backoffice.consultations.get({ query }));
}

/**
 * Exact-CPF search with the explorer's list controls (page, sort, `q`, filters): all in a POST
 * body, so the CPF never reaches a URL (RF-613, RF-615, RF-617).
 */
export function searchConsultationsByCpf(
  body: SearchByCpfRequest,
): Promise<Result<ListResponse<ConsultationListItem>>> {
  return toResult(() => backoffice.consultations["search-by-cpf"].post(body));
}

/** The consultation detail (decrypted CPF included), or null when it doesn't exist. */
export async function getConsultationDetail(id: string): Promise<ConsultationDetail | null> {
  const { data, error } = await backoffice.consultations({ id }).get();
  if (!error) return data;
  const problem = toProblem(error);
  if (problem.status === 401) throw redirect({ to: "/backoffice/login" });
  if (problem.status === 404 || problem.status === 422) return null;
  throw new Error(problem.title);
}

export function listThrottleEvents(query: ListParams): Promise<ListResponse<ThrottleEventItem>> {
  return read(() => backoffice["throttle-events"].get({ query }));
}
