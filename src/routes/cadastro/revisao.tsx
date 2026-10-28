import { useStore } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";

import { useSignup } from "#/components/modules/signup/signup-context";
import { toSignupRequest } from "#/components/modules/signup/signup-form";
import { SignupStep } from "#/components/modules/signup/SignupStep";
import { SignupSummary } from "#/components/modules/signup/SignupSummary";

export const Route = createFileRoute("/cadastro/revisao")({ component: ReviewStep });

/** The last step: the request body as it will be sent, each part editable on its step. */
function ReviewStep() {
  const { form, simulationControls, goBackTo } = useSignup();
  const values = useStore(form.store, (state) => state.values);
  return (
    <SignupStep
      index={3}
      title="Revise os dados"
      description="É isto que será enviado para a análise das financeiras."
    >
      <SignupSummary request={toSignupRequest(values, simulationControls)} onEdit={goBackTo} />
    </SignupStep>
  );
}
