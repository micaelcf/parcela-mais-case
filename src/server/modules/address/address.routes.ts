import { Elysia } from "elysia";
import Type from "typebox";

import { CepSchema } from "#/lib/address/address";
import { throttlePlugin } from "#/server/modules/throttle/throttle.plugin";

import { addressService } from "./address.service";

/** CEP lookup for the signup form (`api.md` § Public): ViaCEP behind a cache and a per-IP cap. */
export const addressRoutes = new Elysia({ name: "address" })
  .use(throttlePlugin)
  .get(
    "/addresses/:cep",
    { throttle: "address.lookup", params: Type.Object({ cep: CepSchema }) },
    ({ params }) => addressService.lookup(params.cep),
  );
