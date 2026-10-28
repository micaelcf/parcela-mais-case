import { type ReactNode, useEffect } from "react";

import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

import { useSignup } from "./signup-context";
import { SIGNUP_STEPS } from "./signup-form";

type SignupStepProps = {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
};

/** One signup step: its fields, "Voltar" after the first step, "Próximo" before the last, submit on the last. */
export function SignupStep({ index, title, description, children }: SignupStepProps) {
  const { form, goNext, goBack } = useSignup();
  // A field drops its errors when its step unmounts. Once this step's fields are mounted, validate
  // again so touched fields show theirs (after "Voltar", or when a submit routes back here).
  useEffect(() => {
    void form.validate("change");
  }, [form]);
  const last = index === SIGNUP_STEPS.length - 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      <CardFooter className="flex justify-between gap-3">
        {index > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => goBack(index)}>
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
