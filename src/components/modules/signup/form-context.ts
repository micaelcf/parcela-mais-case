import { createFormHookContexts } from "@tanstack/react-form";

/** TanStack Form contexts shared by `signup-form.ts` (the hook) and `SignupFields.tsx` (its fields). */
export const { fieldContext, formContext, useFieldContext } = createFormHookContexts();
