import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

import { STEP_HEADING_FOCUS, useSignup } from "./signup-context";
import { SIGNUP_STEPS } from "./signup-form";

type SignupStepProps = {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
};

/**
 * One signup step: its content, "Voltar" after the first step, "Próximo" before the last, submit on
 * the last (the review).
 */
export function SignupStep({ index, title, description, children }: SignupStepProps) {
  const { form, goNext, goBackTo, claimFocus } = useSignup();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A field drops its errors when its step unmounts. Once this step's fields are mounted, validate
  // again (as a blur would) so the fields already left show theirs (after "Voltar", or when a
  // submit routes back here).
  useEffect(() => {
    void form.validate("blur");
  }, [form]);
  // A step without fields takes focus on its heading when entered.
  useEffect(() => {
    if (claimFocus(STEP_HEADING_FOCUS)) headingRef.current?.focus();
  }, [claimFocus]);
  const last = index === SIGNUP_STEPS.length - 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 ref={headingRef} tabIndex={-1} className="font-heading text-xl outline-none">
            {title}
          </h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      <CardFooter className="flex justify-between gap-3">
        {index > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => goBackTo(index - 1)}>
            Voltar
          </Button>
        ) : (
          <span />
        )}
        {last ? (
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button type="submit" size="lg" disabled={submitting}>
                {submitting ? "Enviando…" : "Solicitar pré-aprovação"}
              </Button>
            )}
          </form.Subscribe>
        ) : (
          <Button type="button" size="lg" onClick={() => void goNext(index)}>
            Próximo
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
