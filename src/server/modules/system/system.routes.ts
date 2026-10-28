import { Elysia } from "elysia";

import { env, type ServerEnv } from "#/server/infra/env/server-env";

type SystemConfig = Pick<ServerEnv, "GIT_SHA" | "SIMULATION_CONTROLS">;

/** `GET /health` (process liveness + deployed commit) and `GET /config` (public UI flags). */
export function createSystemRoutes(config: SystemConfig) {
  return new Elysia({ name: "system" })
    .get("/health", () => ({ status: "ok" as const, sha: config.GIT_SHA }))
    .get("/config", () => ({ simulationControls: config.SIMULATION_CONTROLS }));
}

export const systemRoutes = createSystemRoutes(env);
