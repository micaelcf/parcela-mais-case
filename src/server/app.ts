import "#/lib/validation/locale";

import { Elysia } from "elysia";

import { errorsPlugin } from "#/server/infra/http/errors.plugin";
import { systemRoutes } from "#/server/modules/system/system.routes";

/** HTTP composition root: every module's routes under `/api`. */
export const app = new Elysia({ prefix: "/api" }).use(errorsPlugin).use(systemRoutes);

export type App = typeof app;
