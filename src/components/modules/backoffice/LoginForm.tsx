import { useForm } from "@tanstack/react-form";
import { LogInIcon } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { type StandardSchemaV1, toStandardSchema } from "#/lib/validation/standard-schema";
import { type LoginRequest, LoginRequestSchema } from "#/server/modules/backoffice/backoffice.dto";

/**
 * `toStandardSchema` declares its input as `unknown`; TanStack Form wants the form's value type
 * there. Same `validate`, re-declared over the form values (the `types` hint is inference-only).
 */
const loginValidator: StandardSchemaV1<LoginRequest, LoginRequest> = {
  "~standard": { ...toStandardSchema(LoginRequestSchema)["~standard"], types: undefined },
};

/** Every message in a field's error list (schema issues or plain strings). */
function messagesOf(errors: ReadonlyArray<unknown>): string[] {
  return errors.flatMap((error) =>
    typeof error === "string"
      ? [error]
      : typeof error === "object" && error !== null && "message" in error
        ? [String(error.message)]
        : [],
  );
}

/**
 * The operator's sign-in form. `onSubmit` performs the login and resolves to the pt-BR message to
 * show when it fails (null on success).
 */
export function LoginForm({
  onSubmit,
}: {
  onSubmit: (values: LoginRequest) => Promise<string | null>;
}) {
  const id = useId();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { username: "", password: "" } satisfies LoginRequest,
    validators: { onSubmit: loginValidator },
    onSubmit: async ({ value }) => {
      setFailure(null);
      setFailure(await onSubmit(value));
    },
    onSubmitInvalid: ({ formApi }) => {
      const usernameInvalid = (formApi.getFieldMeta("username")?.errors.length ?? 0) > 0;
      (usernameInvalid ? usernameRef : passwordRef).current?.focus();
    },
  });

  return (
    <Card className="mx-auto mt-10 w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl font-semibold">Entrar no backoffice</h1>
        </CardTitle>
        <CardDescription>Acesso restrito à operação da Parcela Mais.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          method="post"
          aria-label="Entrar no backoffice"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            {failure ? (
              <Alert variant="destructive">
                <AlertTitle>Não foi possível entrar</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <form.Field name="username">
              {(field) => (
                <CredentialField
                  id={`${id}-username`}
                  inputRef={usernameRef}
                  label="Usuário"
                  name={field.name}
                  autoComplete="username"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="password">
              {(field) => (
                <CredentialField
                  id={`${id}-password`}
                  inputRef={passwordRef}
                  label="Senha"
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button type="submit" size="lg" disabled={submitting}>
                  <LogInIcon aria-hidden data-icon="inline-start" />
                  {submitting ? "Entrando…" : "Entrar"}
                </Button>
              )}
            </form.Subscribe>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function CredentialField({
  id,
  inputRef,
  label,
  name,
  type = "text",
  autoComplete,
  value,
  errors,
  onBlur,
  onChange,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  name: string;
  type?: "text" | "password";
  autoComplete: string;
  value: string;
  errors: ReadonlyArray<unknown>;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const messages = messagesOf(errors);
  const invalid = messages.length > 0;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="h-10"
      />
      <FieldError id={`${id}-error`}>{invalid ? messages.join(" ") : null}</FieldError>
    </Field>
  );
}
