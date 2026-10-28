import { type HTMLAttributes, type ReactNode, useEffect, useRef } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { SIMULATION_SCENARIOS, type SimulationScenario } from "#/lib/enums";
import { formatCentsInput, parseCentsInput } from "#/lib/money/money";

import { useFieldContext } from "./form-context";
import { fieldId, useSignup } from "./signup-context";

/** Every message in a field's error list: schema issues, plain strings (server errors), nested lists. */
function messagesOf(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(messagesOf);
  if (typeof value === "object" && value !== null && "message" in value) {
    return typeof value.message === "string" ? [value.message] : [];
  }
  return [];
}

/** Shared wiring of a text-like field: ids, visible errors (once touched), focus requests, server-error reset. */
function useTextField() {
  const field = useFieldContext<string>();
  const { claimFocus, serverErrors, clearServerError } = useSignup();
  const ref = useRef<HTMLInputElement>(null);
  const { name } = field;

  useEffect(() => {
    if (claimFocus(name)) ref.current?.focus();
  }, [claimFocus, name]);

  const id = fieldId(name);
  const errorId = `${id}-error`;
  const serverError = serverErrors[name];
  const messages = [
    ...new Set([
      ...(field.state.meta.isTouched ? messagesOf(field.state.meta.errors) : []),
      ...(serverError ? [serverError] : []),
    ]),
  ];
  const invalid = messages.length > 0;

  function change(value: string) {
    if (serverError) clearServerError(name);
    field.handleChange(value);
  }

  return { field, ref, id, errorId, messages, invalid, change };
}

function FieldFrame({
  id,
  errorId,
  label,
  description,
  messages,
  children,
}: {
  id: string;
  errorId: string;
  label: string;
  description?: string;
  messages: string[];
  children: ReactNode;
}) {
  return (
    <Field data-invalid={messages.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description ? (
        <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      ) : null}
      {/* Always rendered with one line reserved: an error appearing on blur must not move the
          buttons below, or a click on "Voltar"/"Próximo" lands on empty space. */}
      <div className="min-h-5">
        <FieldError id={errorId}>{messages.length > 0 ? messages.join(" ") : null}</FieldError>
      </div>
    </Field>
  );
}

type TextFieldProps = {
  label: string;
  description?: string;
  type?: "text" | "date" | "tel";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  placeholder?: string;
  /** Display-only formatter applied as the user types. */
  mask?: (raw: string) => string;
};

export function TextField({
  label,
  description,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  mask,
}: TextFieldProps) {
  const { field, ref, id, errorId, messages, invalid, change } = useTextField();
  const describedBy = invalid ? errorId : description ? `${id}-description` : undefined;
  return (
    <FieldFrame
      id={id}
      errorId={errorId}
      label={label}
      description={description}
      messages={messages}
    >
      <Input
        ref={ref}
        id={id}
        name={field.name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => change(mask ? mask(event.target.value) : event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-10"
      />
    </FieldFrame>
  );
}

/** A BRL amount typed as text (`10.000,00`), tidied into the pt-BR format when it loses focus. */
export function MoneyField({ label, description }: { label: string; description?: string }) {
  const { field, ref, id, errorId, messages, invalid, change } = useTextField();
  const describedBy = invalid ? errorId : description ? `${id}-description` : undefined;
  return (
    <FieldFrame
      id={id}
      errorId={errorId}
      label={label}
      description={description}
      messages={messages}
    >
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
        >
          R$
        </span>
        <Input
          ref={ref}
          id={id}
          name={field.name}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={field.state.value}
          onBlur={() => {
            const cents = parseCentsInput(field.state.value);
            const tidy = cents === null ? field.state.value : formatCentsInput(cents);
            if (tidy !== field.state.value) change(tidy);
            field.handleBlur();
          }}
          onChange={(event) => change(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-10 pl-10 tabular-nums"
        />
      </div>
    </FieldFrame>
  );
}

const SCENARIO_COPY: Record<SimulationScenario, { label: string; description: string }> = {
  NORMAL: { label: "Normal", description: "As financeiras respondem com as regras de sempre." },
  ALL_APPROVE: { label: "Todas aprovam", description: "As quatro financeiras aprovam." },
  DELTA_FAILS: { label: "Delta falha", description: "Delta responde com erro." },
  DELTA_TIMES_OUT: {
    label: "Delta não responde a tempo",
    description: "Delta passa do prazo da consulta.",
  },
  NONE_APPROVE: { label: "Nenhuma aprova", description: "Nenhuma financeira aprova." },
};

/** Simulation scenario picker; rendered only when the API reports simulation controls on. */
export function ScenarioField() {
  const field = useFieldContext<SimulationScenario>();
  const legendId = `${fieldId(field.name)}-legend`;
  return (
    <FieldSet>
      <FieldLegend id={legendId}>Cenário de simulação</FieldLegend>
      <FieldDescription>Força o comportamento das financeiras para demonstração.</FieldDescription>
      <RadioGroup
        id={fieldId(field.name)}
        aria-labelledby={legendId}
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => {
          const picked = SIMULATION_SCENARIOS.find((scenario) => scenario === value);
          if (picked) field.handleChange(picked);
        }}
        className="grid gap-2 sm:grid-cols-2"
      >
        {SIMULATION_SCENARIOS.map((scenario) => (
          <label
            key={scenario}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-accent"
          >
            <RadioGroupItem value={scenario} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{SCENARIO_COPY[scenario].label}</span>
              <span className="text-xs text-muted-foreground">
                {SCENARIO_COPY[scenario].description}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}
