import { ClipboardCheck, Contact, type LucideIcon, UserRound, Wallet } from "lucide-react";

import { Stepper } from "#/components/ui/stepper";

import { SIGNUP_STEPS } from "./signup-form";

const STEP_ICON: Record<(typeof SIGNUP_STEPS)[number]["to"], LucideIcon> = {
  "/cadastro/paciente": UserRound,
  "/cadastro/contato": Contact,
  "/cadastro/financeiro": Wallet,
  "/cadastro/revisao": ClipboardCheck,
};

const STEPS = SIGNUP_STEPS.map((step) => ({ title: step.title, icon: STEP_ICON[step.to] }));

/**
 * "Etapa N de 4" over the steps: the current one marked for assistive tech, the completed ones
 * checked, every reachable one a button (back, or ahead past complete steps), the others disabled.
 */
export function SignupStepper({
  current,
  canReach,
  onStepSelect,
}: {
  current: number;
  canReach: (index: number) => boolean;
  onStepSelect: (index: number) => void;
}) {
  return (
    <Stepper
      steps={STEPS}
      current={current}
      label="Etapas do cadastro"
      caption={`Etapa ${current + 1} de ${STEPS.length}`}
      completedLabel="concluída"
      lockedLabel="conclua as etapas anteriores"
      canSelect={canReach}
      onStepSelect={onStepSelect}
    />
  );
}
