import { afterAll, describe, expect, it } from "vite-plus/test";

// Must be set before any app module reads the env (dynamic imports below).
process.env.SIMULATION_CONTROLS = "false";

const { closeTestApp } = await import("../setup/app-fetch");
const { postConsultation, readProblem, signupBody } = await import("./consultation-client");

afterAll(closeTestApp);

describe("simulation controls off", () => {
  it("rejects forced scenarios when controls are off", async () => {
    const forced = await postConsultation(signupBody({ simulationScenario: "ALL_APPROVE" }));
    expect(forced.status).toBe(422);
    expect((await readProblem(forced)).code).toBe("SIMULATION_DISABLED");

    const normal = await postConsultation(signupBody({ simulationScenario: "NORMAL" }));
    expect(normal.status).toBe(202);
  });
});
