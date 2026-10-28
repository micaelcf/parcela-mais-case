# S12 — the signup tells the patient where they are, scolds only after a field is left, and collects an optional e-mail; routes and design-system components follow the house rules · ~40 files

Added 2026-10-28 (user request; RFC D28 amendment, D29, D30; PRD RF-117–RF-119). Lead: route move and `src/lib/email`; agents: `EmailServer` (API, migration `20261028170739_patient_email`), `SignupUX` (`ui/stepper.tsx`, validation timing, e-mail field, E2E), `DatePickerSearch` (`ui/date-picker.tsx` per shadcn's base "Input" example, `ui/input-group.tsx`, table search on `@tanstack/react-pacer`).
Reads: contract/frontend.md § Routes and § Forms and validation, contract/api.md, contract/schema.md

**C197** · RF-118 — no field shows an error while it's typed; leaving it shows the error, which stays until the next blur; submit validates every field
Proof: `vp test src/components/modules/signup/signup-form.test.ts -t "doesn't validate while typing"` (and `-t "validates when the field loses focus"`, `-t "keeps the error while typing until the next blur"`, `-t "validates every field on submit"`), `vp run e2e test/e2e/signup.spec.ts -g "validates a field when it's left, not while it's typed"`

**C198** · RF-119 — the stepper marks the active step (`aria-current="step"`, highlighted tile, semantic icon) after each `Próximo`, shows completed steps with a check and lets them be revisited
Proof: `vp run e2e test/e2e/signup.spec.ts -g "marks the active step in the stepper"`

**C199** · RF-117 — the e-mail rule: common addresses pass however cased or padded; no `@`, no dotted domain, a short or numeric TLD, dots at the edges or doubled, over 64/254 chars fail; stored trimmed and lower-cased
Proof: `vp test src/lib/email/email.test.ts`

**C200** · RF-117 — the API accepts a create without e-mail, stores a valid one normalised, refuses an invalid one at `email`; the e-mail is in the idempotency hash
Proof: `vp test test/integration/consultation/consultation.create.int.test.ts -t "e-mail"`

**C201** · RF-117, RF-612 — the backoffice detail shows the e-mail normalised, `null` when none; a resubmission without one clears it
Proof: `vp test test/integration/backoffice/backoffice.lists.int.test.ts -t "shows the patient e-mail normalised, a submission without one clearing it"`

**C202** · RF-117, RF-502 — public payloads never carry the e-mail
Proof: `vp test test/integration/consultation/consultation.privacy.int.test.ts -t "public payloads carry no e-mail"`

**C203** · RF-117 — the form keeps the e-mail optional (no `email` key sent when blank), flags an invalid one when it's left, and sends a valid one normalised
Proof: `vp run e2e test/e2e/signup.spec.ts -g "e-mail"`, `vp test src/components/modules/signup/signup-form.test.ts -t "e-mail"`

**C204** · RF-104 (RFC D28 amendment) — the birthdate and the backoffice date filters use `ui/date-picker.tsx` (shadcn base "Input" example: `InputGroup` + `Popover` + `Calendar`); typed `dd/mm/aaaa` and calendar picks (mouse and keyboard) set the ISO value; `31/02/1990` is invalid
Proof: `vp test src/lib/date/date-text.test.ts`, `vp run e2e test/e2e/signup.spec.ts -g "picks the birthdate from the calendar"`, `vp run e2e test/e2e/a11y.spec.ts -g "picks the birthdate from the calendar by keyboard"`, `vp run e2e test/e2e/backoffice.spec.ts -g "filters by a creation date typed or picked from the calendar"`

**C205** · RF-615 (RFC D30) — table search fires one request after typing pauses (400 ms, `@tanstack/react-pacer`), never per keystroke and never after the user left the page
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "searches once typing pauses, never per keystroke nor after leaving"`

**C206** · (no RF; RFC D29) — every parent with two or more nested routes is a directory route (`cadastro/`, `backoffice/`, `backoffice/consultas/`), single-child parents stay flat (`api.$.ts`, `consultas.$consultationId.tsx`); URLs unchanged (the whole E2E suite navigates them)
Proof: `vp run e2e`

**C207** · RF-104 (RFC D28) — the calendar's month and year dropdowns stay open and focused when clicked (clicks inside the popover no longer reach `InputGroupAddon`, which focused the input and closed them)
Proof: `vp run e2e test/e2e/signup.spec.ts -g "keeps the calendar's month and year dropdowns open when clicked"`

Signup navigation round (added 2026-10-28, user report and request, RFC D32):

**C218** · RF-120, RF-121 — a step is complete when its fields pass the form schema (step 1 only with the address shown); a step opens once every earlier step but the one being left is complete; the review collects no field
Proof: `vp test src/components/modules/signup/signup-form.test.ts`

**C219** · RF-120 — a reload on a later step lands on the first step, empty and without error messages
Proof: `vp run e2e test/e2e/signup.spec.ts -g "starts over on the first step after a reload on a later one"`

**C220** · RF-120 — a later step (Financeiro, Revisão) opened directly lands on the first step
Proof: `vp run e2e test/e2e/signup.spec.ts -g "sends a later step opened directly to the first one"`

**C221** · RF-121 — with every step filled, from step 1 the stepper jumps straight to Revisão with values intact and no request sent
Proof: `vp run e2e test/e2e/signup.spec.ts -g "jumps ahead from the stepper over complete steps"`

**C222** · RF-121 — a stepper jump over an incomplete step stops there, focusing its first blocking field with its error shown
Proof: `vp run e2e test/e2e/signup.spec.ts -g "stops a stepper jump at an incomplete step, showing its errors"`

**C223** · RF-122 — Revisão shows the formatted values grouped by step with "Editar" per group (each goes to its step), and the POST body equals what is shown
Proof: `vp run e2e test/e2e/signup.spec.ts -g "reviews exactly what it sends"`
