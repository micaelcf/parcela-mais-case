# S9 — the operator logs in and works the dashboards, explorer, lender switches and abuse view from server-driven tables · ~25 files · est. ~16k

Wave 5. Owns: `src/components/modules/backoffice/**`, `src/api/backoffice.ts`, `src/routes/backoffice*.tsx`, `src/routeTree.gen.ts` (regenerated), `package.json` (`dependencies` only, this wave)
Reads: contract/bindings.md, contract/layout.md, contract/api.md, contract/frontend.md

Non-goals: no change to `components/ui/**` beyond adding shadcn components with the CLI; no API change (S7's routes are the contract, read the code). Copy is pt-BR. Tables are manual (server-driven) TanStack Table v9.

Unit proofs (this slice runs them):

**C145** · RF-617 — the backoffice list search schema round-trips page, pageSize, sort, q and allow-listed filters through the URL, and drops any `cpf` key
Proof: `vp test src/components/modules/backoffice/table-search.test.ts -t "keeps table state in search params without the CPF"`

E2E proofs (written in S10, specs under `test/e2e/`):

**C146** · RF-601 — the configured credentials open `/backoffice` on the pipeline dashboard
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "logs in"`

**C147** · RF-601 — a wrong password shows a pt-BR error and stays on the login page with no session
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "rejects a wrong password"`

**C148** · RF-602, RF-603 — logging out returns to the login page, and opening `/backoffice` afterwards redirects to login
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "logs out"`

**C149** · RF-604, RF-605, RF-606, RF-614 — the pipeline, lender health and abuse views render the figures their API responses carry (intercepted response values appear on screen)
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "renders the dashboards from the API"`

**C150** · RF-607, RF-608, RF-609 — toggling Delta off on the lenders page shows it disabled, adds a switch-log row with the username, and toggling back re-enables it
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "toggles a lender"`

**C151** · RF-615 — changing page, sort, a filter and the search box each issue a GET to `/api/backoffice/consultations` carrying that parameter
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "drives the table from the server"`

**C152** · RF-617 — reloading a consultations URL with page, sort, filter and search restores the same table state
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "keeps table state in the URL"`

**C153** · RF-613, RF-617 — an exact CPF search lists that patient's consultations, and no URL visited during or after it contains the CPF digits; the explorer's "Buscar" box refuses a CPF (raw, formatted, after a name) with the hint, and a name followed by a partial CPF isn't applied after the debounce (extended 2026-10-28, audit Q-5/N2)
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "searches by CPF without putting it in the URL"`

**C168** · RF-617 — the search-box classifier: text whose trailing digit run (ignoring `.`, `-`, spaces) has 1–10 digits applies only on Enter, 11+ is refused as a CPF, whatever words precede it; a whole UUID, a UUID prefix past its first group with a hex letter (`019a2b3c-1234-7123-8123`) and plain words are text, while `529-982-247-25` and an id prefix hiding 11 digits are refused (added 2026-10-28, audit Q-5/N2/N6)
Proof: `vp test src/components/modules/backoffice/table-search.test.ts -t "keeps a CPF typed in the search box out of the URL"`

**C154** · RF-611, RF-612 — the explorer lists consultations, and the detail page shows the formatted decrypted CPF
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "shows the decrypted CPF and the address on the detail"`

**C217** · RF-618 — the public header's "Área da clínica" leads to the backoffice login without a session; after login, the backoffice header's "Ir para o cadastro" leads back to the signup (added 2026-10-28, user request)
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "is reachable from the public header"`
