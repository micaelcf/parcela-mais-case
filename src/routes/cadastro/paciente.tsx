import { createFileRoute } from "@tanstack/react-router";

import { maskCpf } from "#/components/modules/signup/masks";
import { useSignup } from "#/components/modules/signup/signup-context";
import { SignupStep } from "#/components/modules/signup/SignupStep";
import { MAX_AGE_YEARS, MIN_AGE_YEARS } from "#/server/modules/consultation/consultation.dto";

export const Route = createFileRoute("/cadastro/paciente")({ component: PatientStep });

/**
 * Years the calendar reaches past the valid 18–80 ages on each side (today − 85 to today − 13), so
 * a pick just outside still lands and shows the age message.
 */
const BIRTH_YEAR_SLACK = 5;

function PatientStep() {
  const { form, cepStatus } = useSignup();
  const today = new Date();
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();
  // City and UF come with the CEP; typed by hand only when the lookup couldn't answer.
  const fromCep = cepStatus === "found";
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
        {(field) => (
          <field.DateField
            label="Data de nascimento"
            autoComplete="bday"
            startMonth={new Date(thisYear - MAX_AGE_YEARS - BIRTH_YEAR_SLACK, thisMonth, 1)}
            endMonth={new Date(thisYear - MIN_AGE_YEARS + BIRTH_YEAR_SLACK, thisMonth, 1)}
            defaultMonth={new Date(thisYear - 40, 0, 1)}
          />
        )}
      </form.AppField>
      <form.AppField name="cep">{(field) => <field.CepField status={cepStatus} />}</form.AppField>
      {cepStatus === "found" || cepStatus === "unavailable" ? (
        <>
          <form.AppField name="street">
            {(field) => <field.TextField label="Rua" autoComplete="address-line1" />}
          </form.AppField>
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-[10rem_1fr]">
            <form.AppField name="addressNumber">
              {(field) => <field.TextField label="Número" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="complement">
              {(field) => (
                <field.TextField label="Complemento (opcional)" autoComplete="address-line2" />
              )}
            </form.AppField>
          </div>
          <form.AppField name="neighborhood">
            {(field) => <field.TextField label="Bairro" autoComplete="address-level3" />}
          </form.AppField>
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-[1fr_8rem]">
            <form.AppField name="city">
              {(field) => (
                <field.TextField label="Cidade" autoComplete="address-level2" readOnly={fromCep} />
              )}
            </form.AppField>
            <form.AppField name="state">
              {(field) =>
                fromCep ? (
                  <field.TextField label="UF" autoComplete="address-level1" readOnly />
                ) : (
                  <field.StateField label="UF" />
                )
              }
            </form.AppField>
          </div>
        </>
      ) : null}
    </SignupStep>
  );
}
