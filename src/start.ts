import { createStart } from "@tanstack/react-start";

/** No SSR (RFC D25): the server renders only the document shell; route content and data are client-side. */
export const startInstance = createStart(() => ({ defaultSsr: false }));
