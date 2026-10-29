import { createContext, use } from "react";

import type { CepLookupStatus } from "#/hooks/use-cep-lookup";

import type { SignupForm } from "./signup-form";

export type SignupContextValue = {
  form: SignupForm;
  simulationControls: boolean;
  /** Back to an earlier step, focusing its first field. */
  goBackTo: (index: number) => void;
  /** Called by a field (or a fieldless step's heading, as `STEP_HEADING_FOCUS`) once mounted: true
   *  when it should take focus (its step was just entered, or it's the invalid one). */
  claimFocus: (name: string) => boolean;
  /** Messages by form field, shown until the field changes (they survive step changes): the API's
   *  422 ones, and "wait for the address" when "Próximo" meets a CEP still being looked up. */
  serverErrors: Partial<Record<string, string>>;
  clearServerError: (name: string) => void;
  /** The CEP lookup's state: the address fields show only once it's `found` or `unavailable`. */
  cepStatus: CepLookupStatus;
  /** Whether the CEP lookup's verdict (not found, invalid) shows: once the CEP is left or
   *  "Próximo" meets it, until it's typed again. */
  cepVerdictShown: boolean;
  showCepVerdict: (shown: boolean) => void;
};

export const SignupContext = createContext<SignupContextValue | null>(null);

export function useSignup(): SignupContextValue {
  const value = use(SignupContext);
  if (!value) throw new Error("useSignup must be used inside the /cadastro layout");
  return value;
}

/** The DOM id of a field's control, used for labels, error links and focus. */
export function fieldId(name: string): string {
  return `signup-${name}`;
}

/** The focus target of a step without fields (the review): its heading. */
export const STEP_HEADING_FOCUS = "step-heading";
