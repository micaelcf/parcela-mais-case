import { Elysia } from "elysia";

import { ListQuerySchema } from "#/lib/list/list-contract";

import {
  backofficeAuthPlugin,
  SESSION_COOKIE,
  sessionCookieAttributes,
} from "./auth/backoffice-auth.plugin";
import { backofficeSessionService, SESSION_TTL_SECONDS } from "./auth/backoffice-session.service";
import {
  LenderParamsSchema,
  LoginRequestSchema,
  MetricsRangeQuerySchema,
  PipelineQuerySchema,
  SearchByCpfRequestSchema,
  type Session,
  SwitchRequestSchema,
} from "./backoffice.dto";
import { backofficeService } from "./backoffice.service";
import { metricsService } from "./metrics.service";

/** `POST /backoffice/session`: the only backoffice route without a session. */
const loginRoutes = new Elysia({ name: "backoffice-login" }).post(
  "/session",
  { body: LoginRequestSchema },
  async ({ body, cookie, set }) => {
    const value = await backofficeSessionService.login(body.username, body.password);
    // Drop whatever `bo_session` the browser sent first: Elysia re-verifies an incoming signed
    // cookie when serialising the response, so a stale or forged one would turn this login into a
    // 500. Deleting the jar entry makes `set` start a fresh, freshly signed cookie.
    delete cookie[SESSION_COOKIE];
    cookie[SESSION_COOKIE].set({ value, maxAge: SESSION_TTL_SECONDS, ...sessionCookieAttributes });
    set.status = 204;
  },
);

/** Everything else: behind `backofficeAuthPlugin` (401 `UNAUTHENTICATED` without a valid session). */
const guardedRoutes = new Elysia({ name: "backoffice-guarded" })
  .use(backofficeAuthPlugin)
  .get("/session", ({ operator }): Session => ({ username: operator.username }))
  .delete("/session", ({ cookie, set }) => {
    cookie[SESSION_COOKIE].set({
      value: "",
      maxAge: 0,
      expires: new Date(0),
      ...sessionCookieAttributes,
    });
    set.status = 204;
  })
  .get("/metrics/pipeline", { query: PipelineQuerySchema }, ({ query }) =>
    metricsService.pipeline(query),
  )
  .get("/metrics/lenders", { query: MetricsRangeQuerySchema }, ({ query }) =>
    metricsService.lenders(query),
  )
  .get("/metrics/abuse", { query: MetricsRangeQuerySchema }, ({ query }) =>
    metricsService.abuse(query),
  )
  .put(
    "/lenders/:lender/switch",
    { params: LenderParamsSchema, body: SwitchRequestSchema },
    ({ params, body, operator }) =>
      backofficeService.setLenderEnabled({
        slug: params.lender,
        enabled: body.enabled,
        actor: operator.username,
      }),
  )
  .get("/lenders/switch-log", { query: ListQuerySchema }, ({ query }) =>
    backofficeService.listSwitchLog(query),
  )
  .get("/consultations", { query: ListQuerySchema }, ({ query }) =>
    backofficeService.listConsultations(query),
  )
  .post("/consultations/search-by-cpf", { body: SearchByCpfRequestSchema }, ({ body }) =>
    backofficeService.searchByCpf(body),
  )
  .get("/consultations/:id", ({ params }) => backofficeService.consultationDetail(params.id))
  .get("/throttle-events", { query: ListQuerySchema }, ({ query }) =>
    backofficeService.listThrottleEvents(query),
  );

/** Backoffice API (`api.md` § Backoffice), mounted under `/api`. */
export const backofficeRoutes = new Elysia({ name: "backoffice", prefix: "/backoffice" })
  .use(loginRoutes)
  .use(guardedRoutes);
