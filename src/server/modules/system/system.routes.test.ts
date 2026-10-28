import { describe, expect, it } from "vite-plus/test";

import { createSystemRoutes } from "./system.routes";

describe("system routes", () => {
  it("reports the configured commit", async () => {
    const routes = createSystemRoutes({ GIT_SHA: "abc1234", SIMULATION_CONTROLS: false });

    const response = await routes.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", sha: "abc1234" });
  });

  it.each([true, false])("exposes the simulation controls flag (%s)", async (enabled) => {
    const routes = createSystemRoutes({ GIT_SHA: "abc1234", SIMULATION_CONTROLS: enabled });

    const response = await routes.handle(new Request("http://localhost/config"));

    expect(await response.json()).toEqual({ simulationControls: enabled });
  });
});
