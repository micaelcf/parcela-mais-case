import { createFileRoute } from "@tanstack/react-router";

import { useSignup } from "#/components/modules/signup/signup-context";
import { SignupStep } from "#/components/modules/signup/SignupStep";

export const Route = createFileRoute("/cadastro/financeiro")({ component: FinancialStep });

function FinancialStep() {
  const { form, simulationControls } = useSignup();
  return (
    <SignupStep
      index={2}
      title="Dados financeiros"
      description="A renda e o valor do tratamento orientam a análise das financeiras."
    >
      <form.AppField name="monthlyIncome">
        {(field) => <field.MoneyField label="Renda mensal" />}
      </form.AppField>
      <form.AppField name="treatmentAmount">
        {(field) => (
          <field.MoneyField
            label="Valor do tratamento"
            description="Entre R$ 1.000,00 e R$ 50.000,00."
          />
        )}
      </form.AppField>
      {simulationControls ? (
        <form.AppField name="simulationScenario">
          {(field) => <field.ScenarioField />}
        </form.AppField>
      ) : null}
    </SignupStep>
  );
}
