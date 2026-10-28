import type { LenderCode } from "#/lib/enums";
import { env } from "#/server/infra/env/server-env";

import { createAlfaAdapter } from "./alfa/alfa.adapter";
import { createBetaAdapter } from "./beta/beta.adapter";
import { createDeltaAdapter } from "./delta/delta.adapter";
import { createGamaAdapter } from "./gama/gama.adapter";
import type { LenderAdapterDeps, LenderPort } from "./lender.port";

export type LenderRegistry = Readonly<Record<LenderCode, LenderPort>>;

export function createLenderRegistry(deps: LenderAdapterDeps): LenderRegistry {
  return {
    ALFA: createAlfaAdapter(deps),
    BETA: createBetaAdapter(deps),
    GAMA: createGamaAdapter(deps),
    DELTA: createDeltaAdapter(deps),
  };
}

export const lenderRegistry: LenderRegistry = createLenderRegistry({
  baseUrl: env.LENDER_BASE_URL,
  fetch: (input, init) => globalThis.fetch(input, init),
});
