import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";

import { DatePicker } from "#/components/date-picker/DatePicker";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { CepLookupStatus } from "#/hooks/use-cep-lookup";
import { BR_STATES, CEP_MESSAGE } from "#/lib/address/address";
import { SIMULATION_SCENARIOS, type SimulationScenario } from "#/lib/enums";
import { formatCentsInput, parseCentsInput } from "#/lib/money/money";

import { useFieldContext } from "./form-context";
import { maskCep } from "./masks";
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

/**
 * Shared wiring of a field: ids, visible errors (once touched), focus requests, server-error reset.
 * `extraMessages` are shown whether touched or not (a CEP lookup's verdict).
 */
function useTextField<E extends HTMLElement = HTMLInputElement>(extraMessages: string[] = []) {
  const field = useFieldContext<string>();
  const { claimFocus, serverErrors, clearServerError } = useSignup();
  const ref = useRef<E>(null);
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
      ...extraMessages,
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
  status,
  messages,
  children,
}: {
  id: string;
  errorId: string;
  label: string;
  description?: string;
  /** A polite live message on the reserved line while no error shows (rendered when defined). */
  status?: string;
  messages: string[];
  children: ReactNode;
}) {
  const showError = messages.length > 0;
  return (
    <Field data-invalid={showError || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description ? (
        <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      ) : null}
      {/* Always rendered with one line reserved: an error appearing on blur must not move the
          buttons below, or a click on "Voltar"/"Próximo" lands on empty space. */}
      <div className="min-h-5">
        <FieldError id={errorId}>{showError ? messages.join(" ") : null}</FieldError>
        {status === undefined ? null : (
          <p id={`${id}-status`} role="status" className="text-sm text-muted-foreground">
            {showError ? null : status}
          </p>
        )}
      </div>
    </Field>
  );
}

type TextFieldProps = {
  label: string;
  description?: string;
  type?: "text" | "tel";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  placeholder?: string;
  readOnly?: boolean;
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
  readOnly,
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
        readOnly={readOnly}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => change(mask ? mask(event.target.value) : event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-10 read-only:bg-muted/50"
      />
    </FieldFrame>
  );
}

type DateFieldProps = {
  label: string;
  autoComplete?: string;
  /** First and last months the calendar offers. */
  startMonth: Date;
  endMonth: Date;
  defaultMonth?: Date;
};

/** A calendar day typed as `dd/mm/aaaa` or picked from a calendar; the form holds ISO `YYYY-MM-DD`. */
export function DateField({
  label,
  autoComplete,
  startMonth,
  endMonth,
  defaultMonth,
}: DateFieldProps) {
  const { field, ref, id, errorId, messages, invalid, change } = useTextField();
  return (
    <FieldFrame id={id} errorId={errorId} label={label} messages={messages}>
      <DatePicker
        id={id}
        name={field.name}
        value={field.state.value}
        onValueChange={change}
        onBlur={field.handleBlur}
        startMonth={startMonth}
        endMonth={endMonth}
        defaultMonth={defaultMonth}
        calendarLabel="Abrir calendário"
        autoComplete={autoComplete}
        inputRef={ref}
        invalid={invalid}
        describedBy={invalid ? errorId : undefined}
      />
    </FieldFrame>
  );
}

/** What the CEP's reserved line says while a lookup runs or after it couldn't answer. */
const CEP_STATUS_TEXT: Partial<Record<CepLookupStatus, string>> = {
  loading: "Buscando endereço…",
  unavailable: "Não foi possível consultar o CEP agora. Preencha o endereço.",
};

/** A lookup verdict shown as the CEP's error until the CEP changes. */
const CEP_STATUS_ERROR: Partial<Record<CepLookupStatus, string>> = {
  not_found: "CEP não encontrado",
  invalid: CEP_MESSAGE,
};

/** The CEP, masked as typed; the layout looks it up and reports the lookup's status here. */
export function CepField({ status }: { status: CepLookupStatus }) {
  const lookupError = CEP_STATUS_ERROR[status];
  const { field, ref, id, errorId, messages, invalid, change } = useTextField(
    lookupError ? [lookupError] : [],
  );
  const statusText = CEP_STATUS_TEXT[status] ?? "";
  const describedBy = invalid ? errorId : statusText ? `${id}-status` : undefined;
  return (
    <FieldFrame id={id} errorId={errorId} label="CEP" status={statusText} messages={messages}>
      <Input
        ref={ref}
        id={id}
        name={field.name}
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="00000-000"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => change(maskCep(event.target.value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-10 tabular-nums"
      />
    </FieldFrame>
  );
}

const STATE_ITEMS = BR_STATES.map((state) => ({ value: state, label: state }));

/** The UF picked from the 27, for an address typed by hand (the lookup was unavailable). */
export function StateField({ label }: { label: string }) {
  const { field, ref, id, errorId, messages, invalid, change } = useTextField<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  return (
    <FieldFrame id={id} errorId={errorId} label={label} messages={messages}>
      <Select
        items={STATE_ITEMS}
        value={field.state.value || null}
        onValueChange={(next: string | null) => change(next ?? "")}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) field.handleBlur();
        }}
      >
        <SelectTrigger
          ref={ref}
          id={id}
          onBlur={() => {
            if (!open) field.handleBlur();
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="w-full data-[size=default]:h-10"
        >
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="max-h-64">
          {STATE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
