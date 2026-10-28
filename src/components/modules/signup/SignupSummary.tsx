import { cn } from "cn";
import { Pencil } from "lucide-react";

import { Button } from "#/components/ui/button";
import { dateTextFromIso } from "#/lib/date/date-text";
import { formatBRL } from "#/lib/money/money";
import type { SignupRequest } from "#/server/modules/consultation/consultation.dto";

import { maskCep, maskCpf, maskPhone } from "./masks";
import { SIGNUP_STEPS, stepOfField } from "./signup-form";
import { SCENARIO_COPY } from "./SignupFields";

/** A value on one line, or on several (the address). */
type Fact = { label: string; value: string | readonly string[] };

/** The request's values grouped by the step that collects them, formatted as typed. */
function summaryGroups(request: SignupRequest): Array<{ step: number; facts: Fact[] }> {
  const { address, simulationScenario } = request;
  return [
    {
      step: stepOfField("fullName"),
      facts: [
        { label: "Nome completo", value: request.fullName },
        { label: "CPF", value: maskCpf(request.cpf) },
        { label: "Data de nascimento", value: dateTextFromIso(request.birthdate) },
        {
          label: "Endereço",
          value: [
            `${address.street}, ${address.number}${address.complement ? ` – ${address.complement}` : ""}`,
            `${address.neighborhood}, ${address.city}/${address.state}`,
            `CEP ${maskCep(address.cep)}`,
          ],
        },
      ],
    },
    {
      step: stepOfField("phone"),
      facts: [
        { label: "Celular", value: maskPhone(request.phone) },
        { label: "E-mail", value: request.email ?? "Não informado" },
      ],
    },
    {
      step: stepOfField("monthlyIncome"),
      facts: [
        { label: "Renda mensal", value: formatBRL(request.monthlyIncomeCents) },
        { label: "Valor do tratamento", value: formatBRL(request.treatmentAmountCents) },
        ...(simulationScenario
          ? [{ label: "Cenário de simulação", value: SCENARIO_COPY[simulationScenario].label }]
          : []),
      ],
    },
  ];
}

/**
 * What the signup is about to send, read from the request body itself (so what shows is what
 * goes): one section per step, each with an "Editar" that goes back to that step.
 */
export function SignupSummary({
  request,
  onEdit,
}: {
  request: SignupRequest;
  onEdit: (step: number) => void;
}) {
  return (
    <div className="flex flex-col divide-y">
      {summaryGroups(request).map(({ step, facts }) => {
        const { title } = SIGNUP_STEPS[step];
        const headingId = `signup-summary-${step}`;
        return (
          <section
            key={step}
            aria-labelledby={headingId}
            className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={headingId} className="font-heading text-base font-medium">
                {title}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(step)}>
                <Pencil aria-hidden />
                Editar<span className="sr-only"> {title}</span>
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(({ label, value }) => (
                <div
                  key={label}
                  className={cn(
                    "flex flex-col gap-0.5",
                    typeof value !== "string" && "sm:col-span-2",
                  )}
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-medium break-words tabular-nums">
                    {typeof value === "string"
                      ? value
                      : value.map((line) => (
                          <span key={line} className="block">
                            {line}
                          </span>
                        ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
