import "#/lib/validation/locale";

import { Elysia, setupTypebox } from "elysia";

import { errorsPlugin } from "#/server/infra/http/errors.plugin";
import { simulatorPlugin } from "#/server/integrations/lenders/simulator/simulator.plugin";
import { consultationRoutes } from "#/server/modules/consultation/consultation.routes";
import { systemRoutes } from "#/server/modules/system/system.routes";

// The production bundle drops Elysia's automatic TypeBox registration (`t` is never read).
setupTypebox();

/** HTTP composition root: every module's routes under `/api`. */
export const app = new Elysia({ prefix: "/api" })
  .use(errorsPlugin)
  .use(systemRoutes)
  .use(simulatorPlugin)
  .use(consultationRoutes);

export type App = typeof app;
