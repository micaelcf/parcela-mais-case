import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { createConsultation, getConfig } from "#/api/consultations";
import { AppShell } from "#/components/AppShell";
import { fieldId, SignupContext } from "#/components/modules/signup/signup-context";
import {
  formFieldForRequestPath,
  SIGNUP_FIELD_ORDER,
  SIGNUP_STEPS,
  type SignupFieldName,
  type SignupFormValues,
  stepOfField,
  toSignupRequest,
  useSignupForm,
} from "#/components/modules/signup/signup-form";
import { SignupProgress } from "#/components/modules/signup/SignupProgress";

export const Route = createFileRoute("/cadastro")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, "") === "/cadastro") {
      throw redirect({ to: "/cadastro/paciente", replace: true });
    }
  },
  loader: () => getConfig(),
  component: SignupLayout,
});

/**
 * Owns the one signup form and its idempotency key for the three step routes, so moving between
 * steps keeps every value. Nothing is persisted: a reload starts over.
 */
function SignupLayout() {
  const { simulationControls } = Route.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = SIGNUP_STEPS.findIndex((step) => step.to === pathname);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const focusTarget = useRef<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});

  const clearServerError = useCallback((name: string) => {
    setServerErrors(({ [name]: _cleared, ...rest }) => rest);
  }, []);

  const claimFocus = useCallback((name: string) => {
    if (focusTarget.current !== name) return false;
    focusTarget.current = null;
    return true;
  }, []);

  function focusField(name: SignupFieldName) {
    const step = stepOfField(name);
    if (step === current) {
      document.getElementById(fieldId(name))?.focus();
      return;
    }
    focusTarget.current = name;
    void navigate({ to: SIGNUP_STEPS[step].to });
  }

  function hasErrors(name: SignupFieldName) {
    return (form.getFieldMeta(name)?.errors.length ?? 0) > 0;
  }

  function touch(name: SignupFieldName) {
    form.setFieldMeta(name, (meta) => ({ ...meta, isTouched: true }));
  }

  async function submit(values: SignupFormValues) {
    const result = await createConsultation(
      toSignupRequest(values, simulationControls),
      idempotencyKey,
    );
    if (result.ok) {
      await navigate({
        to: "/consultas/$consultationId",
        params: { consultationId: result.value.id },
      });
      return;
    }
    const { problem } = result;
    const fieldErrors = (problem.fields ?? []).flatMap((error) => {
      const name = formFieldForRequestPath(error.path);
      return name ? [{ name, message: error.message }] : [];
    });
    setServerErrors(Object.fromEntries(fieldErrors.map(({ name, message }) => [name, message])));
    const first = SIGNUP_FIELD_ORDER.find((name) =>
      fieldErrors.some((error) => error.name === name),
    );
    if (first) focusField(first);
    toast.error(problem.title, { description: problem.detail });
  }

  function submitInvalid() {
    const invalid = SIGNUP_FIELD_ORDER.filter(hasErrors);
    for (const name of invalid) touch(name);
    if (invalid[0]) focusField(invalid[0]);
  }

  const form = useSignupForm({ onSubmit: submit, onSubmitInvalid: submitInvalid });

  async function goNext(from: number) {
    const step = SIGNUP_STEPS[from];
    const next = SIGNUP_STEPS[from + 1];
    await form.validate("change");
    for (const name of step.fields) touch(name);
    const invalid = step.fields.find(hasErrors);
    if (invalid) {
      focusField(invalid);
      return;
    }
    focusTarget.current = next.fields[0];
    await navigate({ to: next.to });
  }

  function goBack(from: number) {
    const previous = SIGNUP_STEPS[from - 1];
    focusTarget.current = previous.fields[0];
    void navigate({ to: previous.to });
  }

  return (
    <AppShell>
      <SignupContext
        value={{
          form,
          simulationControls,
          goNext,
          goBack,
          claimFocus,
          serverErrors,
          clearServerError,
        }}
      >
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          {current >= 0 ? <SignupProgress current={current} /> : null}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (current < SIGNUP_STEPS.length - 1) void goNext(current);
              else void form.handleSubmit();
            }}
          >
            <Outlet />
          </form>
        </div>
      </SignupContext>
    </AppShell>
  );
}
