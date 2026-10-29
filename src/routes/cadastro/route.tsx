import { useSelector } from "@tanstack/react-form";
import {
  createFileRoute,
  Navigate,
  Outlet,
  redirect,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createConsultation, getConfig } from "#/api/consultations";
import { AppShell } from "#/components/AppShell";
import {
  fieldId,
  SignupContext,
  STEP_HEADING_FOCUS,
} from "#/components/modules/signup/signup-context";
import {
  discardSignupDraft,
  loadSignupDraft,
  saveSignupDraft,
} from "#/components/modules/signup/signup-draft";
import {
  ADDRESS_DETAIL_FIELDS,
  canReachStep,
  completedSteps,
  formFieldForRequestPath,
  isAddressDetailField,
  SIGNUP_FIELD_ORDER,
  SIGNUP_STEPS,
  type SignupFieldName,
  type SignupFormValues,
  stepOfField,
  toSignupRequest,
  useSignupForm,
} from "#/components/modules/signup/signup-form";
import { SignupStepper } from "#/components/modules/signup/SignupStepper";
import { StepperContent } from "#/components/ui/stepper";
import { type SettledCepLookup, useCepLookup } from "#/hooks/use-cep-lookup";
import { normalizeCep } from "#/lib/address/address";

/** "Próximo" with a valid CEP whose lookup hasn't answered yet. */
const AWAIT_ADDRESS = "Informe o CEP e aguarde o endereço";

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
 * Owns the one signup form and its idempotency key for the step routes, so moving between steps
 * keeps every value. The values (and the CEP lookup behind the address) are also kept as this
 * tab's draft (`signup-draft.ts`), saved whenever a field is left and when the page goes away, so
 * a reload resumes where it was; a sent signup discards it. The idempotency key isn't kept: one per
 * page load. A step opens only once every earlier one is complete; arriving anywhere else (a typed
 * URL, browser history, an expired draft) lands on the first incomplete step.
 */
function SignupLayout() {
  const { simulationControls } = Route.useLoaderData();
  const navigate = useNavigate();
  // The step on screen (the rendered child route), not the location: during a navigation the
  // location changes before the next step renders.
  const shownRouteId = useChildMatches({ select: (matches) => matches[0]?.routeId });
  const current = SIGNUP_STEPS.findIndex((step) => step.to === shownRouteId);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [draft] = useState(loadSignupDraft);
  /** The latest lookup answer, saved with the draft while the CEP it answered is still typed. */
  const lastLookup = useRef<SettledCepLookup | null>(draft?.cepLookup ?? null);
  const sent = useRef(false);
  const focusTarget = useRef<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});
  const [cepVerdictShown, setCepVerdictShown] = useState(false);

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

  /** Hidden address fields don't block, show errors or take focus; an unresolved CEP blocks. */
  function blocks(name: SignupFieldName) {
    if (isAddressDetailField(name)) return addressShown && hasErrors(name);
    return hasErrors(name) || (name === "cep" && !addressShown);
  }

  /** Shows `name`'s errors as if it had been left (validation runs on blur and submit). */
  function touch(name: SignupFieldName) {
    form.setFieldMeta(name, (meta) => ({ ...meta, isTouched: true, isBlurred: true }));
    if (name === "cep") setCepVerdictShown(true);
  }

  /** Touches what blocks among `fields` (the CEP's wait message too); focuses the first of them. */
  function stopAtFirstBlocking(fields: readonly SignupFieldName[]): boolean {
    const blocking = fields.filter(blocks);
    for (const name of blocking) touch(name);
    if (blocking.includes("cep") && !hasErrors("cep") && cepStatus === "loading") {
      setServerErrors((errors) => ({ ...errors, cep: AWAIT_ADDRESS }));
    }
    if (blocking[0]) focusField(blocking[0]);
    return blocking.length > 0;
  }

  /** A CEP answer: the address fields refilled from it (or emptied for typing), untouched again. */
  function applyLookup(settled: SettledCepLookup) {
    lastLookup.current = settled;
    const { result } = settled;
    if (result.kind !== "found" && result.kind !== "unavailable") return;
    const found = result.kind === "found" ? result.address : null;
    const values: Record<(typeof ADDRESS_DETAIL_FIELDS)[number], string> = {
      street: found?.street ?? "",
      addressNumber: "",
      complement: "",
      neighborhood: found?.neighborhood ?? "",
      city: found?.city ?? "",
      state: found?.state ?? "",
    };
    for (const name of ADDRESS_DETAIL_FIELDS) {
      form.setFieldValue(name, values[name], { dontUpdateMeta: true });
      form.setFieldMeta(name, (meta) => ({ ...meta, isTouched: false, isBlurred: false }));
    }
    setServerErrors(({ cep: _cep, ...errors }) =>
      Object.fromEntries(
        Object.entries(errors).filter(([name]) => !ADDRESS_DETAIL_FIELDS.some((f) => f === name)),
      ),
    );
    if (found) focusTarget.current = "addressNumber";
  }

  async function submit(values: SignupFormValues) {
    const result = await createConsultation(
      toSignupRequest(values, simulationControls),
      idempotencyKey,
    );
    if (result.ok) {
      sent.current = true;
      discardSignupDraft();
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
    stopAtFirstBlocking(SIGNUP_FIELD_ORDER);
  }

  const form = useSignupForm({
    onSubmit: submit,
    onSubmitInvalid: submitInvalid,
    initialValues: draft?.values,
  });
  const values = useSelector(form.store, (state) => state.values);
  const cepStatus = useCepLookup(values.cep, applyLookup, draft?.cepLookup ?? null);
  const addressShown = cepStatus === "found" || cepStatus === "unavailable";
  const completed = useMemo(() => completedSteps(values, addressShown), [values, addressShown]);

  // When a value last changed: the draft's 30 minutes count from there, so saving it again (a blur,
  // the page going away) never extends it. A restored draft keeps its time until the next edit.
  const editedAt = useRef<number | null>(draft?.editedAt ?? null);
  const valuesAtMount = useRef(values);
  useEffect(() => {
    if (values !== valuesAtMount.current) editedAt.current = Date.now();
  }, [values]);

  /** This tab's draft, from the form as it is now (nothing once the signup was sent). */
  function saveDraft() {
    if (sent.current) return;
    const formValues = form.state.values;
    const lookup = lastLookup.current;
    saveSignupDraft({
      values: formValues,
      cepLookup: lookup?.cep === normalizeCep(formValues.cep) ? lookup : null,
      editedAt: editedAt.current ?? Date.now(),
    });
  }
  // A reload or a closed tab while typing in a field that was never left.
  const saveOnPageHide = useEffectEvent(saveDraft);
  useEffect(() => {
    const onPageHide = () => saveOnPageHide();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  /** What takes focus when step `index` is entered: its first field, or its heading. */
  function entryFocus(index: number): string {
    const fields: readonly SignupFieldName[] = SIGNUP_STEPS[index].fields;
    return fields.at(0) ?? STEP_HEADING_FOCUS;
  }

  /**
   * From step `from` on to the later step `to` ("Próximo", or the stepper): checks the steps in
   * between and stops at the first one that blocks, showing its errors.
   */
  async function goForward(from: number, to: number) {
    await form.validate("blur");
    const between: readonly SignupFieldName[] = SIGNUP_STEPS.slice(from, to).flatMap(
      (step) => step.fields,
    );
    if (stopAtFirstBlocking(between)) return;
    focusTarget.current = entryFocus(to);
    await navigate({ to: SIGNUP_STEPS[to].to });
  }

  /** Back to an earlier step ("Voltar", the stepper, a review's "Editar"), focusing its first field. */
  function goBackTo(index: number) {
    focusTarget.current = entryFocus(index);
    void navigate({ to: SIGNUP_STEPS[index].to });
  }

  function goToStep(index: number) {
    if (index < current) goBackTo(index);
    else void goForward(current, index);
  }

  const canReach = (index: number) => canReachStep(completed, index, current);
  // Not reachable from what's filled in: off to the first incomplete step, as if just arrived.
  if (current > 0 && !canReach(current)) {
    return (
      <AppShell>
        <Navigate to={SIGNUP_STEPS[completed.indexOf(false)].to} replace />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <SignupContext
        value={{
          form,
          simulationControls,
          goBackTo,
          claimFocus,
          serverErrors,
          clearServerError,
          cepStatus,
          cepVerdictShown,
          showCepVerdict: setCepVerdictShown,
        }}
      >
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          {current >= 0 ? (
            <SignupStepper current={current} canReach={canReach} onStepSelect={goToStep} />
          ) : null}
          <form
            noValidate
            // React's onBlur bubbles (focusout): any field left saves the draft.
            onBlur={saveDraft}
            onSubmit={(event) => {
              event.preventDefault();
              if (current < SIGNUP_STEPS.length - 1) void goForward(current, current + 1);
              else void form.handleSubmit();
            }}
          >
            <StepperContent step={current}>
              <Outlet />
            </StepperContent>
          </form>
        </div>
      </SignupContext>
    </AppShell>
  );
}
