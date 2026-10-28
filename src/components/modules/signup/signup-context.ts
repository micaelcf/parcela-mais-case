import { createContext, use } from "react";

import type { SignupForm } from "./signup-form";

export type SignupContextValue = {
  form: SignupForm;
  simulationControls: boolean;
  /** Validates the step's fields; moves on only when they're all valid, else focuses the first invalid. */
  goNext: (from: number) => Promise<void>;
  goBack: (from: number) => void;
  /** Called by a field once mounted: true when it should take focus (its step was just entered, or it's the invalid one). */
  claimFocus: (name: string) => boolean;
  /** API 422 messages by form field, shown until the field changes (they survive step changes). */
  serverErrors: Partial<Record<string, string>>;
  clearServerError: (name: string) => void;
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
