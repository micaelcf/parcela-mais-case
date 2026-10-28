# Frontend

pt-BR UI, no SSR, every datum from the API over HTTP.

## Shell

- `src/router.tsx`: `createRouter({ routeTree, defaultSsr: false, scrollRestoration: true, … })`. Route content renders client-only (`ClientOnly`). The root `shellComponent` still emits the static document (`__root.tsx`: `<html lang="pt-BR">`, `HeadContent`, `Scripts`, theme init script). It must not read data.
- `src/routes/api.$.ts`: `createFileRoute("/api/$")({ server: { handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle } } })` with `handle = ({ request }) => app.fetch(request)`. Server routes resolve before rendering, independent of `defaultSsr`.
- Remove the template's demo files: `routes/about.tsx`, `components/{Header,Footer,ThemeToggle,demo.FormComponents}.tsx`, `hooks/demo.*`, `data/demo-table-data.ts`.

## Routes (TanStack file routes)

| Route file                                 | Path                    | Purpose                                                                                                                                    |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.tsx`                                | `/`                     | redirect → `/cadastro/paciente`                                                                                                            |
| `cadastro.tsx`                             | `/cadastro`             | layout: owns the **single** form instance (`useAppForm`) + idempotency key (`crypto.randomUUID()` once on mount), step header, `<Outlet/>` |
| `cadastro.paciente.tsx`                    | `/cadastro/paciente`    | step 1: full name, CPF, birthdate                                                                                                          |
| `cadastro.contato.tsx`                     | `/cadastro/contato`     | step 2: mobile phone                                                                                                                       |
| `cadastro.financeiro.tsx`                  | `/cadastro/financeiro`  | step 3: monthly income, treatment amount, scenario picker (only if `GET /api/config` → `simulationControls`), submit                       |
| `consultas.$consultationId.tsx`            | `/consultas/:id`        | journey: 4 lender cards (reserved height, no CLS), offers + sort toggle, choose, confirmation, no-offer explanation + requote              |
| `backoffice.login.tsx`                     | `/backoffice/login`     | login form                                                                                                                                 |
| `backoffice.tsx`                           | `/backoffice`           | layout; `beforeLoad` → `GET /api/backoffice/session`, 401 → redirect to login                                                              |
| `backoffice.index.tsx`                     | `/backoffice`           | money pipeline + lender health                                                                                                             |
| `backoffice.consultas.index.tsx`           | `/backoffice/consultas` | explorer list + exact-CPF search (POST, never URL)                                                                                         |
| `backoffice.consultas.$consultationId.tsx` |                         | detail with decrypted CPF                                                                                                                  |
| `backoffice.financeiras.tsx`               |                         | lender health table, kill switches, switch log                                                                                             |
| `backoffice.abuso.tsx`                     |                         | abuse & limits                                                                                                                             |

Moving between steps never resets values: the form lives in the `cadastro` layout. Each step validates its own fields before "Próximo". A reload restarts the form (D14); nothing goes to Web Storage. After submit → `navigate("/consultas/$id")`.

## Data access

- `src/web/api/eden.ts`: `export const api = treaty<App>(location.origin).api` (import type `App` only). Browser-only module. Loaders call it client-side (`defaultSsr: false`).
- TanStack Query isn't installed; loaders + Eden + router invalidation are the data layer. Don't add Query without amending the contract.
- `use-consultation-stream.ts`: `AbortController` per connection, aborted on unmount and before reconnect. `for await (const ev of res.data)` reads the **envelope** (`ev.event`, `ev.data`). On stream error or end while `quoteStatus !== "SETTLED"`, reconnect with backoff (500 ms → 1 s → 2 s → 4 s cap). The first message of every connection is a full snapshot that **replaces** state.
- Table state (page, pageSize, sort, q, filters) lives in **typed search params** (`validateSearch` with the shared `ListQuery` TypeBox via the Standard Schema adapter). The CPF is never in the URL.
- Offer sorting ("menor parcela" / "menor custo total") reorders API values in the browser. No money arithmetic in the browser: format only (`shared/domain/money.ts`).

## Forms and validation

- TanStack Form via `createFormHook` (pattern from `src/hooks/demo.form.ts`, moved to `src/web/features/signup/`).
- The form-level validator is `toStandardSchema(SignupFormSchema)` on `onChange` + `onSubmit`. Field errors land on fields via issue paths (proven).
- Schemas come from `consultation.schemas.ts` (drizzle-derived and refined; `Cpf` refine from `shared/domain/cpf.ts`). Inputs keep raw strings; the schema works on normalised digits. Masking is display-only via zero-dependency formatters.
- Messages: `shared/schema/locale.ts` sets `System.Locale.Set(System.Locale.pt_BR)` once (imported by both the server app and the browser entry), plus `error` annotations for domain messages ("CPF inválido"). The adapter honours both. Don't render `form.state.errors` raw: it contains a path → issues map.
- Server 422 `fields[]` is mapped back onto form fields by path after submit.
- Keep TypeBox's default `maxErrors` (8): the form has 6 fields.

## UI kit

- shadcn with **Base UI** primitives, style `base-nova`, CSS variables on. Components are vendored in `src/components/ui/` via the shadcn CLI run in a temp copy, then committed. `components.json` aliases use `@/` (CLI requirement; see `bindings.md`).
- Tokens: shadcn semantic variables live **only** in `src/theme.css`, imported by `src/styles.css`. Swapping the theme = replacing that one file. The template's `--sea-ink…` tokens are removed with the demo shell. Dark mode keeps the existing `.dark` class mechanism.
- Data tables: `@tanstack/react-table@9.3.1` (v9 API: `useTable`, `tableFeatures`) in **manual** pagination/sorting/filtering mode, wired to the list contract (`api.md`). One shared `DataTable` component.
- Charts: shadcn `chart` (recharts). Toasts: `sonner`.
- Accessibility: Base UI `Field` wires `aria-invalid`/`aria-describedby`; focus the first invalid field on submit; each lender card is a `role="status" aria-live="polite"` region; every action is keyboard-reachable with visible focus.
