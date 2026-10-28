# Signatures

Cross-slice declarations, verbatim. Written at Stage 4 because slices that run in parallel, or before their consumer, can't see each other's code. A producer exports exactly this name and shape from exactly this path; a consumer imports exactly this. Code the lead lands in S0/S1 isn't repeated here: once a producer has landed, later slices read the code.

## Produced by S2 (CPF, PII, Price)

`#/lib/cpf/cpf.ts` (isomorphic, no `node:*`):

```ts
export function normalizeCpf(input: string): string; // strips every non-digit
export function cpfCheckDigits(base9: string): string; // the 2 check digits for 9 base digits
export function isValidCpf(input: string): boolean; // formatted or not; 11 digits, not all equal, check digits match
export const CpfSchema; // Type.Refine(Type.String(), isValidCpf) carrying the pt-BR message "CPF inválido"
```

`#/server/lib/crypto/cpf-crypto.ts` (the only `node:crypto` importer for PII):

```ts
export type CpfCrypto = {
  readonly keyVersion: number;
  blindIndex(cpfDigits: string): Buffer; // HMAC-SHA256(hmacKey, "cpf:v1:" + digits), 32 bytes
  encrypt(cpfDigits: string, aad: Buffer): Buffer; // iv(12) ‖ ct(11) ‖ tag(16) = 39 bytes, AES-256-GCM
  decrypt(ciphertext: Buffer, aad: Buffer): string; // throws on a wrong AAD or tampering
};
export function createCpfCrypto(keys: { hmacKey: Buffer; encryptionKey: Buffer; keyVersion: number }): CpfCrypto;
export const cpfCrypto: CpfCrypto; // from env (PII_HMAC_KEY, PII_ENCRYPTION_KEY, PII_KEY_VERSION), created on first use
```

`#/server/lib/crypto/ip-hash.ts`:

```ts
export function createIpHasher(hmacKey: Buffer): (ip: string) => Buffer; // HMAC-SHA256(key, "ip:v1:" + ip)
export const hashIp: (ip: string) => Buffer; // from env PII_HMAC_KEY
```

`#/server/modules/pricing/price.ts` (pure):

```ts
export function divRoundHalfUp(num: bigint, den: bigint): bigint; // num ≥ 0, den > 0
export function priceInstallment(input: {
  principalCents: number;
  monthlyRate: string;
  termMonths: number;
}): {
  installmentCents: number;
  totalCents: number; // installmentCents × termMonths
};
```

## Produced by S3 (lender integration)

`#/server/integrations/lenders/lender.port.ts`: exactly as in [lender-port.md](lender-port.md), plus `export const LENDER_CODES = ["ALFA", "BETA", "GAMA", "DELTA"] as const` (the display/order source).

`#/server/integrations/lenders/registry.ts`:

```ts
export type LenderRegistry = Readonly<Record<LenderCode, LenderPort>>;
export function createLenderRegistry(deps: LenderAdapterDeps): LenderRegistry;
export const lenderRegistry: LenderRegistry; // baseUrl = env.LENDER_BASE_URL, fetch = globalThis.fetch
```

`#/server/modules/lender/circuit-breaker.ts` (pure):

```ts
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
export const BREAKER = {
  windowSize: 20,
  failureThreshold: 16,
  windowMs: 300_000,
  openMs: 30_000,
} as const;
export type BreakerSample = {
  status: AttemptStatus;
  reason: AttemptReason | null;
  calledAt: Date;
  settledAt: Date;
};
export function breakerState(samples: readonly BreakerSample[], now: Date): BreakerState;
// samples: the lender's NORMAL, called, settled attempts, newest first. The function itself drops samples
// settled before now − windowMs and keeps at most windowSize, so callers can over-fetch safely.
```

`#/server/integrations/lenders/simulator/simulator.plugin.ts`:

```ts
export type SimulatorOptions = { timeScale: number; deltaFailureRate: number; random?: () => number };
export function createSimulatorPlugin(opts: SimulatorOptions); // new Elysia({ prefix: "/simulator/lenders" })
export const simulatorPlugin; // createSimulatorPlugin from env
```

Mounted by `app.ts` under `/api`, so lenders answer at `/api/simulator/lenders/<lender>/…` (`api.md` § Lender simulator).

## Produced by S4 (orchestration), consumed by S5–S9

`#/server/app.ts`: `export const app; export type App = typeof app;`

`#/server/worker.ts` (composition root; `worker.main.ts` only calls it and wires signals; the generic runtime is `infra/worker/run-worker.ts`):

```ts
export type Worker = { start(): Promise<void>; stop(): Promise<void> };
export function createWorker(deps?: { lenderRegistry?: LenderRegistry }): Worker;
```

`test/integration/setup/app-fetch.ts` (integration-test wiring, not a factory): `export const appFetch: typeof fetch` = `(input, init) => app.handle(new Request(input, init))`, and `export const testLenderRegistry = createLenderRegistry({ baseUrl: "http://localhost/api/simulator/lenders", fetch: appFetch })`.

`#/server/modules/lender/lender-setting.service.ts`:

```ts
export const lenderSettingService: {
  list(): Promise<Array<{ lender: LenderCode; enabled: boolean; updatedAt: Date | null }>>;
  isEnabled(tx: Tx, lender: LenderCode): Promise<boolean>;
  setEnabled(input: { lender: LenderCode; enabled: boolean; actor: string }): Promise<{ lender: LenderCode; enabled: boolean; updatedAt: Date }>;
  // one TX: update lender_setting + append lender_switch_log
};
```

`#/server/modules/lender/lender-attempt.service.ts`: `lenderAttemptService.breakerStates(now?: Date): Promise<Record<LenderCode, BreakerState>>`.

## Produced by S5 (ops), consumed by S6

`#/server/modules/backoffice/auth/password.ts` (`node:crypto` scrypt, no env):

```ts
export function hashPassword(password: string): Promise<string>; // "scrypt:<N>:<r>:<p>:<saltB64>:<hashB64>", N=16384 r=8 p=1, 16-byte salt, 64-byte key
export function verifyPassword(password: string, encoded: string): Promise<boolean>; // timingSafeEqual; false on a malformed value
```

## Reporting exception

Backoffice read models (`backoffice/*.repository.ts`) may `SELECT` from other modules' tables for aggregates and lists. Writes still go through the owning module's service.
