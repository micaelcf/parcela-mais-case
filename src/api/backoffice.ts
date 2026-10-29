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

import { api, ApiError, type Result, toResult } from "./eden";

const backoffice = api.backoffice;

type EdenResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { status: unknown; value: unknown } };

/** A list endpoint's query (`api.md` § List contract): paging, sort, `q` and top-level filters. */
type ListParams = Readonly<Record<string, string | number>>;

/** A read for a loader: the body, a redirect to the login page on 401, an `ApiError` otherwise. */
async function read<T>(call: () => Promise<EdenResponse<T>>): Promise<T> {
  const result = await toResult(call);
  if (result.ok) return result.value;
  if (result.problem.status === 401) throw redirect({ to: "/backoffice/login" });
  throw new ApiError(result.problem);
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
  const result = await toResult(() => backoffice.session.get());
  if (result.ok) return result.value;
  if (result.problem.status === 401) return null;
  throw new ApiError(result.problem);
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
  const result = await toResult(() => backoffice.consultations({ id }).get());
  if (result.ok) return result.value;
  if (result.problem.status === 401) throw redirect({ to: "/backoffice/login" });
  if (result.problem.status === 404 || result.problem.status === 422) return null;
  throw new ApiError(result.problem);
}

export function listThrottleEvents(query: ListParams): Promise<ListResponse<ThrottleEventItem>> {
  return read(() => backoffice["throttle-events"].get({ query }));
}
