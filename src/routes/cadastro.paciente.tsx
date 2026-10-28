import { createFileRoute } from "@tanstack/react-router";

import { maskCpf } from "#/components/modules/signup/masks";
import { useSignup } from "#/components/modules/signup/signup-context";
import { SignupStep } from "#/components/modules/signup/SignupStep";

export const Route = createFileRoute("/cadastro/paciente")({ component: PatientStep });

function PatientStep() {
  const { form } = useSignup();
  return (
    <SignupStep index={0} title="Dados do paciente" description="Quem vai fazer o tratamento.">
      <form.AppField name="fullName">
        {(field) => <field.TextField label="Nome completo" autoComplete="name" />}
      </form.AppField>
      <form.AppField name="cpf">
        {(field) => (
          <field.TextField
            label="CPF"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            mask={maskCpf}
          />
        )}
      </form.AppField>
      <form.AppField name="birthdate">
        {(field) => <field.TextField label="Data de nascimento" type="date" autoComplete="bday" />}
      </form.AppField>
    </SignupStep>
  );
}
