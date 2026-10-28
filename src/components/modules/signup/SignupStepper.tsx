import { Contact, type LucideIcon, UserRound, Wallet } from "lucide-react";

import { Stepper } from "#/components/ui/stepper";

import { SIGNUP_STEPS } from "./signup-form";

const STEP_ICON: Record<(typeof SIGNUP_STEPS)[number]["to"], LucideIcon> = {
  "/cadastro/paciente": UserRound,
  "/cadastro/contato": Contact,
  "/cadastro/financeiro": Wallet,
};

const STEPS = SIGNUP_STEPS.map((step) => ({ title: step.title, icon: STEP_ICON[step.to] }));

/**
 * "Etapa N de 3" over the three steps: the current one marked for assistive tech, the completed
 * ones checked and clickable to go back.
 */
export function SignupStepper({
  current,
  onStepSelect,
}: {
  current: number;
  onStepSelect: (index: number) => void;
}) {
  return (
    <Stepper
      steps={STEPS}
      current={current}
      label="Etapas do cadastro"
      caption={`Etapa ${current + 1} de ${STEPS.length}`}
      completedLabel="concluída"
      onStepSelect={onStepSelect}
    />
  );
}
