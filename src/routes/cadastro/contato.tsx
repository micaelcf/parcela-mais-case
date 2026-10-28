import { createFileRoute } from "@tanstack/react-router";

import { maskPhone } from "#/components/modules/signup/masks";
import { useSignup } from "#/components/modules/signup/signup-context";
import { SignupStep } from "#/components/modules/signup/SignupStep";

export const Route = createFileRoute("/cadastro/contato")({ component: ContactStep });

function ContactStep() {
  const { form } = useSignup();
  return (
    <SignupStep index={1} title="Contato" description="Para a clínica falar com o paciente.">
      <form.AppField name="phone">
        {(field) => (
          <field.TextField
            label="Celular com DDD"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(11) 98765-4321"
            mask={maskPhone}
          />
        )}
      </form.AppField>
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="E-mail (opcional)"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nome@exemplo.com"
          />
        )}
      </form.AppField>
    </SignupStep>
  );
}
