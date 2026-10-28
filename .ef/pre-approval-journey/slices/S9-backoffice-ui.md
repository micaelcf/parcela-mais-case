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

**C153** · RF-613, RF-617 — an exact CPF search lists that patient's consultations, and no URL visited during or after it contains the CPF digits
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "searches by CPF without putting it in the URL"`

**C154** · RF-611, RF-612 — the explorer lists consultations, and the detail page shows the formatted decrypted CPF
Proof: `vp run e2e test/e2e/backoffice.spec.ts -g "shows the decrypted CPF on the detail"`
