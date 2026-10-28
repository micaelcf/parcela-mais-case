import { useForm } from "@tanstack/react-form";
import { SearchIcon, XIcon } from "lucide-react";
import Type, { type Static } from "typebox";
import { useId, useRef } from "react";

import { maskCpf } from "#/components/modules/signup/masks";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { CpfSchema } from "#/lib/cpf/cpf";
import { type StandardSchemaV1, toStandardSchema } from "#/lib/validation/standard-schema";

const CpfSearchSchema = Type.Object({ cpf: CpfSchema });
type CpfSearchValues = Static<typeof CpfSearchSchema>;

/** The adapter over the form's own value type (see `LoginForm`). */
const cpfSearchValidator: StandardSchemaV1<CpfSearchValues, CpfSearchValues> = {
  "~standard": { ...toStandardSchema(CpfSearchSchema)["~standard"], types: undefined },
};

/**
 * Exact-CPF search (RF-613). The CPF lives only in this form's state and the POST body that
 * `onSearch` sends: the form never submits to a URL (RF-617).
 */
export function CpfSearchForm({
  active,
  onSearch,
  onClear,
}: {
  /** True while results of a CPF search are shown. */
  active: boolean;
  onSearch: (cpf: string) => Promise<void>;
  onClear: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: { cpf: "" } satisfies CpfSearchValues,
    validators: { onSubmit: cpfSearchValidator },
    onSubmit: ({ value }) => onSearch(value.cpf),
    onSubmitInvalid: () => inputRef.current?.focus(),
  });

  return (
    <form
      noValidate
      method="post"
      aria-label="Buscar consultas por CPF"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-wrap items-start gap-3"
    >
      <form.Field name="cpf">
        {(field) => {
          const messages = field.state.meta.errors.flatMap((error) =>
            typeof error === "object" && error !== null && "message" in error
              ? [String(error.message)]
              : [],
          );
          const invalid = messages.length > 0;
          return (
            <Field data-invalid={invalid || undefined} className="w-64">
              <FieldLabel htmlFor={`${id}-cpf`}>CPF do paciente</FieldLabel>
              <Input
                ref={inputRef}
                id={`${id}-cpf`}
                name="cpf"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(maskCpf(event.target.value))}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-cpf-error` : `${id}-cpf-description`}
                className="h-9"
              />
              {invalid ? (
                <FieldError id={`${id}-cpf-error`}>{messages.join(" ")}</FieldError>
              ) : (
                <FieldDescription id={`${id}-cpf-description`}>
                  Busca exata. O CPF não fica no endereço da página.
                </FieldDescription>
              )}
            </Field>
          );
        }}
      </form.Field>
      <div className="flex gap-2 pt-6">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting} className="h-9">
              <SearchIcon aria-hidden data-icon="inline-start" />
              {submitting ? "Buscando…" : "Buscar por CPF"}
            </Button>
          )}
        </form.Subscribe>
        {active ? (
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              form.reset();
              onClear();
            }}
          >
            <XIcon aria-hidden data-icon="inline-start" />
            Limpar busca por CPF
          </Button>
        ) : null}
      </div>
    </form>
  );
}
