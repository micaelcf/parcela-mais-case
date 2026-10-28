import { cn } from "#/lib/utils";

import { SIGNUP_STEPS } from "./signup-form";

/** "Etapa N de 3" with the three step names; the current one marked for assistive tech. */
export function SignupProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Etapas do cadastro" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Etapa {current + 1} de {SIGNUP_STEPS.length}
      </p>
      <ol className="grid grid-cols-3 gap-2">
        {SIGNUP_STEPS.map((step, index) => (
          <li
            key={step.to}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "border-t-4 pt-2 text-sm",
              index <= current
                ? "border-primary font-medium"
                : "border-muted text-muted-foreground",
            )}
          >
            {step.title}
          </li>
        ))}
      </ol>
    </nav>
  );
}
