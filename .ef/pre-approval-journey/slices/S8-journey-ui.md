# S8 — a clinic operator completes signup, watches four lender cards live, compares and chooses an offer, or requotes · ~35 files · est. ~20k

Wave 4. Owns: `components.json`, `src/theme.css`, `src/styles.css`, `src/components/ui/**`, `src/components/*.tsx` (app shell), `src/components/modules/{signup,consultation}/**`, `src/hooks/use-consultation-stream.ts`, `src/hooks/reconnect-backoff.ts`, `src/api/eden.ts`, `src/api/consultations.ts`, `src/lib/utils.ts`, `src/lib/money/**`, `src/routes/{index,cadastro,cadastro.paciente,cadastro.contato,cadastro.financeiro,consultas.$consultationId}.tsx`, `src/routeTree.gen.ts` (regenerated), `package.json` (`dependencies` only, this wave)
Reads: contract/bindings.md, contract/layout.md, contract/api.md, contract/frontend.md

Non-goals: no backoffice screens (S9 reuses this slice's `components/ui/**` and shell). No E2E specs: those are written in S10 against this UI; until then the builder checks its surface in a browser against `vp run up`. All copy is pt-BR. Components never import `src/api/eden.ts` (layout.md § Data boundaries).

Unit proofs (this slice runs them):

**C118** · RF-404 — `sortOffers(offers, "installment")` orders by `installmentCents` ascending, ties broken by lender order then `termMonths`
Proof: `vp test src/components/modules/consultation/sort-offers.test.ts -t "sorts by lowest installment"`

**C119** · RF-405 — `sortOffers(offers, "total")` orders by `totalCents` ascending with the same tiebreak
Proof: `vp test src/components/modules/consultation/sort-offers.test.ts -t "sorts by lowest total"`

**C120** · RF-208 — the reconnect delay sequence is 500, 1000, 2000, 4000, 4000 ms and resets to 500 after a snapshot arrives
Proof: `vp test src/hooks/reconnect-backoff.test.ts -t "backs off up to 4 s and resets on a snapshot"`

**C121** · RF-402 — `formatBRL(97428)` → `"R$ 974,28"` and `formatBRL(1169136)` → `"R$ 11.691,36"` (non-breaking space normalised), and `formatRate("0.024900")` → `"2,49% a.m."`
Proof: `vp test src/lib/money/money.test.ts -t "formats cents and monthly rates in pt-BR"`

E2E proofs (written in S10, `vp run e2e <spec> -g "<title>"`, specs under `test/e2e/`):

**C122** · RF-101 — the fields span three steps (`/cadastro/paciente`, `/cadastro/contato`, `/cadastro/financeiro`), then the review `/cadastro/revisao`; the submit button exists only on the review (amended 2026-10-28, RFC D32)
Proof: `vp run e2e test/e2e/signup.spec.ts -g "collects fourteen fields across three steps, then reviews them"`

**C123** · RF-102 — typing `529.982.247-24` shows "CPF inválido" linked to the CPF input by `aria-describedby`, and "Próximo" doesn't leave the step
Proof: `vp run e2e test/e2e/signup.spec.ts -g "flags an invalid CPF on the field"`

**C124** · RF-104 — birthdates for ages 17 and 81 show a field error on the birthdate input
Proof: `vp run e2e test/e2e/signup.spec.ts -g "flags ages outside 18–80"`

**C125** · RF-105 — treatment amounts R$ 999,99 and R$ 50.000,01 show a field error; R$ 1.000,00 and R$ 50.000,00 don't
Proof: `vp run e2e test/e2e/signup.spec.ts -g "flags amounts outside the bounds"`

**C126** · RF-106 — after filling steps 1–2, going back to step 1 and forward again shows every value intact
Proof: `vp run e2e test/e2e/signup.spec.ts -g "keeps values when moving back"`

**C127** · RF-107 — while filling, `localStorage` holds no entered value (the draft is in `sessionStorage` only); once sent, neither store holds one and a new signup in the tab starts empty (amended 2026-10-28, RFC D34)
Proof: `vp run e2e test/e2e/signup.spec.ts -g "keeps the draft in this tab's session only, and drops it once sent"`

**C128** · RF-215 — with `/api/config` answering `simulationControls: false` (route intercepted), the scenario picker isn't rendered
Proof: `vp run e2e test/e2e/signup.spec.ts -g "hides the scenario picker when controls are off"`

**C129** · RF-203 — the consultation page shows four lender cards, each showing exactly one of "consultando", "aprovada", "recusada", "indisponível"
Proof: `vp run e2e test/e2e/journey.spec.ts -g "shows four lender cards"`

**C130** · RF-204 — in `NORMAL`, Alfa's card leaves "consultando" while Delta's still shows it, with no navigation
Proof: `vp run e2e test/e2e/journey.spec.ts -g "updates cards live"`

**C131** · RF-207 — reloading mid-consultation shows the same card states, and cards keep updating afterwards
Proof: `vp run e2e test/e2e/journey.spec.ts -g "restores state on reload"`

**C132** · RF-214 — with controls on, the picker offers the four forced scenarios and each run ends in its expected screen (4 members)
Proof: `vp run e2e test/e2e/scenarios.spec.ts`

**C133** · RF-301 — in `NONE_APPROVE` each card explains its outcome ("valor acima do limite", "perfil não elegível" or "indisponível") and the page text contains none of "renda", "10x", "idade", "25 anos", "20.000"
Proof: `vp run e2e test/e2e/no-approval.spec.ts -g "explains each lender without rule internals"`

**C134** · RF-302 — the no-approval panel suggests half the requested amount (Alfa's hint), formatted in BRL
Proof: `vp run e2e test/e2e/no-approval.spec.ts -g "suggests the hinted amount"`

**C135** · RF-303 — accepting the suggestion opens a new `/consultas/<id>` whose requested amount is the suggested one
Proof: `vp run e2e test/e2e/no-approval.spec.ts -g "requotes with the suggested amount"`

**C136** · RF-401 — the Alfa offer shows "2,49% a.m." and terms 6, 12 and 18
Proof: `vp run e2e test/e2e/offers.spec.ts -g "shows rate and terms"`

**C137** · RF-402 — for R$ 10.000,00, Alfa 12x shows "R$ 974,28" and total "R$ 11.691,36"
Proof: `vp run e2e test/e2e/offers.spec.ts -g "shows Price installments and totals"`

**C138** · RF-403 — the Beta offer shows "valor aprovado menor que o solicitado"; Alfa's doesn't
Proof: `vp run e2e test/e2e/offers.spec.ts -g "flags a partial approval"`

**C139** · RF-404, RF-405 — the sort toggle puts the lowest installment first, then the lowest total first
Proof: `vp run e2e test/e2e/offers.spec.ts -g "sorts offers"`

**C140** · RF-406 — choosing shows a confirmation, and a reload still shows it for that offer
Proof: `vp run e2e test/e2e/offers.spec.ts -g "persists the choice across reloads"`

**C141** · RF-407 — an Alfa offer can be chosen while Delta's card still shows "consultando"
Proof: `vp run e2e test/e2e/offers.spec.ts -g "chooses before all lenders answer"`

**C142** · RF-809 — signup through choice completes with the keyboard only, and every focused control shows a visible focus indicator (non-`none` outline or ring)
Proof: `vp run e2e test/e2e/a11y.spec.ts -g "completes the journey by keyboard"`

**C143** · RF-810 — each lender card is a `role="status"` region with `aria-live="polite"` whose text changes when its state changes
Proof: `vp run e2e test/e2e/a11y.spec.ts -g "announces lender status changes"`

**C144** · (no RF; D25 no SSR) the raw HTML served for `/cadastro/paciente` contains `<html lang="pt-BR">` and no form control
Proof: `vp run e2e test/e2e/no-ssr.spec.ts -g "serves the shell without route content"`

Offer screen round (added 2026-10-28, user request, RFC D32):

**C224** · RF-411 — `groupOffersByLender` orders each group's rows by the sort and the groups by their best offer (ties in lender order); no offers → no groups
Proof: `vp test src/components/modules/consultation/sort-offers.test.ts`

**C225** · RF-411, RF-413 — offers appear in one open group per lender, each with the lender's logo and name, its offer count and best-value hint
Proof: `vp run e2e test/e2e/offers.spec.ts -g "groups offers by lender"`

**C226** · RF-411 — collapsing a lender group hides its rows; expanding shows them again
Proof: `vp run e2e test/e2e/offers.spec.ts -g "collapses and expands a lender group"`

**C227** · RF-412 — "Escolher" opens the confirmation dialog; "Cancelar" sends no choice request and nothing is chosen; only "Confirmar escolha" chooses (the existing choose tests go through it)
Proof: `vp run e2e test/e2e/offers.spec.ts -g "cancels a choice without sending it"`

**C228** · RF-809, RF-412, RF-122 — C142's keyboard journey now passes the review step and confirms the choice in the dialog by keyboard, with visible focus throughout
Proof: `vp run e2e test/e2e/a11y.spec.ts -g "completes the journey by keyboard"`

**C229** · RF-414 — "Novo cadastro" on the offers screen opens the first signup step with an empty form (added 2026-10-28, user request)
Proof: `vp run e2e test/e2e/offers.spec.ts -g "starts a new signup from the offers screen"`

**C230** · RF-812 — without a stored choice the theme follows the system, also when it changes while the page is open
Proof: `vp run e2e test/e2e/theme.spec.ts -g "follows the system theme until the user picks one"`

**C231** · RF-812 — the top-bar toggle switches the theme, and the choice survives a reload (applied before first paint) over the system setting
Proof: `vp run e2e test/e2e/theme.spec.ts -g "switches the theme from the top bar and keeps the choice after a reload"`

**C232** · RF-812 — the backoffice top bar has the same toggle
Proof: `vp run e2e test/e2e/theme.spec.ts -g "offers the switch in the backoffice too"`

**C245** · RF-220 — the live view polls `GET /consultations/:id` every 2 s after two refused or stalled (3 s without a first snapshot) connections, or 2 s past the deadline; a recovered stream stops it and drops a read in flight; it stops at `SETTLED`; a settled view opens nothing (added 2026-10-28, user request)
Proof: `vp test src/hooks/consultation-feed.test.ts` (each rule survives a mutation check: removing it fails its test); `vp run e2e test/e2e/journey.spec.ts -g "keeps the cards updating by polling when the live stream fails"`

**C246** · RF-813 — an unknown address shows "Erro 404: Página não encontrada" (focused) with "Voltar ao início"; an unknown consultation shows its own 404 with "Novo cadastro"; an API outage on load shows "Erro 503: Serviço indisponível", and "Tentar de novo" loads the consultation once the API is back; the status shown is the API's, 503 when unreachable, 500 otherwise (added 2026-10-28, user request)
Proof: `vp run e2e test/e2e/errors.spec.ts`; `vp test src/components/modules/error/error-status.test.ts`
