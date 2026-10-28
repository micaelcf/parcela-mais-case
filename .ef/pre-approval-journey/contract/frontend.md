# Frontend

pt-BR UI, no SSR, every datum from the API over HTTP.

## Shell

- `src/start.ts`: `export const startInstance = createStart(() => ({ defaultSsr: false }))` (the Start entry the plugin discovers; `defaultSsr` is not a `createRouter` option in 1.169: amended 2026-10-28, implementation). `src/router.tsx` keeps `createRouter({ routeTree, scrollRestoration: true, … })`. The root `shellComponent` still emits the static document (`__root.tsx`: `<html lang="pt-BR">`, `HeadContent`, `Scripts`, theme init script). It must not read data.
- `src/routes/api.$.ts`: `createFileRoute("/api/$")({ server: { handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle } } })` with `handle = ({ request }) => app.fetch(request)`. Server routes resolve before rendering, independent of `defaultSsr`.
- Remove the template's demo files: `routes/about.tsx`, `components/{Header,Footer,ThemeToggle,demo.FormComponents}.tsx`, `hooks/demo.*`, `data/demo-table-data.ts`.

## Routes (TanStack file routes)

**Convention (amended 2026-10-28, user rule; RFC D29):** a parent with **two or more** nested routes is a directory (`<segment>/route.tsx` for the layout when there is one, one file per child); a parent with a single nested route stays a flat `.` file (`api.$.ts`, `consultas.$consultationId.tsx`). See https://tanstack.com/router/latest/docs/routing/file-based-routing#directory-routes.

| Route file                                 | Path                    | Purpose                                                                                                                                |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                                | `/`                     | redirect → `/cadastro/paciente`                                                                                                        |
| `cadastro/route.tsx`                       | `/cadastro`             | layout: owns the **single** form instance (`useAppForm`) + idempotency key (`crypto.randomUUID()` once on mount), stepper, `<Outlet/>` |
| `cadastro/paciente.tsx`                    | `/cadastro/paciente`    | step 1: full name, CPF, birthdate, CEP-first address                                                                                   |
| `cadastro/contato.tsx`                     | `/cadastro/contato`     | step 2: mobile phone, optional e-mail                                                                                                  |
| `cadastro/financeiro.tsx`                  | `/cadastro/financeiro`  | step 3: monthly income, treatment amount, scenario picker (only if `GET /api/config` → `simulationControls`), submit                   |
| `consultas.$consultationId.tsx`            | `/consultas/:id`        | journey: 4 lender cards (reserved height, no CLS), offers + sort toggle, choose, confirmation, no-offer explanation + requote          |
| `backoffice/route.tsx`                     | `/backoffice`           | layout; `beforeLoad` → `GET /api/backoffice/session`, 401 → redirect to login                                                          |
| `backoffice/login.tsx`                     | `/backoffice/login`     | login form                                                                                                                             |
| `backoffice/index.tsx`                     | `/backoffice`           | money pipeline + lender health                                                                                                         |
| `backoffice/consultas/index.tsx`           | `/backoffice/consultas` | explorer list + exact-CPF search (POST, never URL)                                                                                     |
| `backoffice/consultas/$consultationId.tsx` |                         | detail with decrypted CPF, address and e-mail                                                                                          |
| `backoffice/financeiras.tsx`               |                         | lender health table, kill switches, switch log                                                                                         |
| `backoffice/abuso.tsx`                     |                         | abuse & limits                                                                                                                         |

Moving between steps never resets values: the form lives in the `cadastro` layout. Each step validates its own fields before "Próximo". A reload restarts the form (D14); nothing goes to Web Storage. After submit → `navigate("/consultas/$id")`.

## Data access

- `src/api/eden.ts`: `export const api = treaty<App>(location.origin).api` (import type `App` only). Browser-only module. `src/api/consultations.ts` and `src/api/backoffice.ts` wrap it in typed fetchers/mutations. Only route loaders/`beforeLoad`, the stream hook and mutation event handlers call `src/api/*` (layout.md § Data boundaries); components never import it.
- TanStack Query isn't installed; loaders + Eden + router invalidation are the data layer. Don't add Query without amending the contract.
- `src/hooks/use-consultation-stream.ts`: `AbortController` per connection, aborted on unmount and before reconnect. `for await (const ev of res.data)` reads the **envelope** (`ev.event`, `ev.data`). On stream error or end while `quoteStatus !== "SETTLED"`, reconnect with backoff (500 ms → 1 s → 2 s → 4 s cap). The first message of every connection is a full snapshot that **replaces** state.
- Table state (page, pageSize, sort, q, filters) lives in **typed search params** (`validateSearch` with the `ListQuery` TypeBox from `lib/list/list-contract.ts` via the Standard Schema adapter). The CPF is never in the URL. Free-text table search (`classifySearchText`, `table-search.ts`): text holding a CPF-shaped run, or whose trailing digit run (ignoring `.`, `-`, spaces) has 11+ digits, is refused with the hint "O CPF não entra nesta busca."; 1–10 trailing digits apply only on Enter, never on the 400 ms debounce, whatever words precede them; a consultation id (a whole UUID, or a prefix past its first group holding a hex letter) and text not ending in digits apply on the debounce (amended 2026-10-28, audit Q-5/N2/N6). The debounce is `@tanstack/react-pacer`'s `useDebouncer` (400 ms trailing), cancelled by Enter (which applies at once), by unmount, by a URL change from elsewhere and by navigating away; a filter change writes only the filters that changed (amended 2026-10-28, RFC D30).
- Offer sorting ("menor parcela" / "menor custo total") reorders API values in the browser (`components/modules/consultation/sort-offers.ts`, pure). No money arithmetic in the browser: format only (`lib/money/money.ts`).

## Forms and validation

- **Design-system inputs only (RFC D28, 2026-10-28):** no native `type="date"`/`datetime-local` inputs and no `<select>` outside `src/components/ui/**`. Dates use `ui/date-picker.tsx`, shadcn's base "Date Picker → Input" example (`InputGroup` + `InputGroupButton` + `Popover` + `Calendar`, registry primitives from the CLI; pt-BR `dd/mm/aaaa` text, ISO `YYYY-MM-DD` value, ArrowDown opens); choices use the shadcn `Select`. The registry calendar's month/year dropdowns are its own native selects inside `ui/calendar.tsx` (shadcn as published). Reusable design-system components live in `src/components/ui/` (`stepper.tsx`, `date-picker.tsx`).
- **Stepper (RFC D30, RF-119):** `ui/stepper.tsx` (React Bits Stepper motion in this app's tokens) with semantic icons (Paciente `UserRound`, Contato `Contact`, Financeiro `Wallet`), `aria-current="step"` on the active step, drawn check on completed ones (clickable to go back); `StepperContent` animates step changes in `cadastro/route.tsx`.
- **Address (RFC D27):** step 1 shows the CEP after the birthdate; the lookup goes through `src/api/addresses.ts` (`GET /api/addresses/:cep`); street, number, complement, neighborhood, city and UF appear only after the CEP resolves (found → prefilled, city/UF read-only; unavailable → empty and editable; not found → error on the CEP, fields hidden).
- TanStack Form via `createFormHook` in `src/components/modules/signup/signup-form.ts` (pattern from the template's `src/hooks/demo.form.ts`, which is deleted).
- The form-level validator is `toStandardSchema(SignupFormSchema)` on **blur only** (amended 2026-10-28, RFC D30, RF-118): TanStack's submit runs the blur validator too, and errors show only on fields that were left (`isBlurred`), never while typing. `Próximo` validates its step with `form.validate("blur")`. Field errors land on fields via issue paths (proven). The optional e-mail (step 2, `src/lib/email`) is validated only when non-blank and omitted from the request when blank.
- DTO schemas come from `server/modules/consultation/consultation.dto.ts` (drizzle-derived and refined; `CpfSchema` from `lib/cpf/cpf.ts`). Inputs keep raw strings; the schema works on normalised digits. Masking is display-only via zero-dependency formatters.
- Messages: `lib/validation/locale.ts` sets `System.Locale.Set(System.Locale.pt_BR)` once (imported by both the server app and the browser entry), plus `error` annotations for domain messages ("CPF inválido"). The adapter honours both. Don't render `form.state.errors` raw: it contains a path → issues map.
- Server 422 `fields[]` is mapped back onto form fields by path after submit.
- Keep TypeBox's default `maxErrors` (8): the form has 6 fields.

## UI kit

- shadcn with **Base UI** primitives, style `base-nova`, CSS variables on. Components are vendored in `src/components/ui/` via the shadcn CLI run in a temp copy, then committed. `components.json` aliases use `@/` (CLI requirement; see `bindings.md`).
- Tokens: shadcn semantic variables live **only** in `src/theme.css`, imported by `src/styles.css`. Swapping the theme = replacing that one file. The template's `--sea-ink…` tokens are removed with the demo shell. Dark mode keeps the existing `.dark` class mechanism.
- Data tables: `@tanstack/react-table@9.3.1` (v9 API: `useTable`, `tableFeatures`) in **manual** pagination/sorting/filtering mode, wired to the list contract (`api.md`). One `DataTable` component in `components/modules/backoffice/DataTable.tsx`.
- Charts: shadcn `chart` (recharts). Toasts: `sonner`.
- Accessibility: Base UI `Field` wires `aria-invalid`/`aria-describedby`; focus the first invalid field on submit; each lender card is a `role="status" aria-live="polite"` region; every action is keyboard-reachable with visible focus.
