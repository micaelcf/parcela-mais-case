# S2 — CPF validation, CPF/IP protection and the exact Price calculation are correct in isolation · ~8 files · est. ~4k

Wave 1. Owns: `src/lib/cpf/cpf.ts`, `src/lib/cpf/cpf.test.ts`, `src/server/lib/crypto/**`, `src/server/modules/pricing/price.ts`, `src/server/modules/pricing/price.test.ts`
Reads: contract/bindings.md, contract/layout.md, contract/signatures.md, contract/boundaries.md

Non-goals: no DB access, no HTTP route, no offer persistence (S4 owns `pricing.service.ts` and `offer.repository.ts`). Export exactly the names in `signatures.md` § S2.

Valid CPFs for tests: compute them with `cpfCheckDigits` from 9 base digits; `529.982.247-25` is a known valid one.

**C12** · RF-801 — `isValidCpf` accepts valid CPFs both formatted (`529.982.247-25`) and unformatted (`52998224725`), over at least 5 distinct valid numbers
Proof: `vp test src/lib/cpf/cpf.test.ts -t "accepts valid CPFs formatted and unformatted"`

**C13** · RF-801, RF-102 — `isValidCpf` rejects a wrong first check digit (`529.982.247-15`) and a wrong second one (`529.982.247-24`)
Proof: `vp test src/lib/cpf/cpf.test.ts -t "rejects a wrong check digit"`

**C14** · RF-801 — `isValidCpf` rejects all ten repeated-digit CPFs (`000.000.000-00` … `999.999.999-99`)
Proof: `vp test src/lib/cpf/cpf.test.ts -t "rejects repeated-digit CPFs"`

**C15** · RF-801 — `isValidCpf` rejects 10 and 12 digits, the empty string, and letters mixed into 11 digits
Proof: `vp test src/lib/cpf/cpf.test.ts -t "rejects wrong lengths and non-digits"`

**C16** · RF-103 — `CpfSchema` fails a compiled TypeBox check for `529.982.247-24` with the message "CPF inválido" and passes `529.982.247-25`
Proof: `vp test src/lib/cpf/cpf.test.ts -t "CpfSchema rejects invalid check digits with a pt-BR message"`

**C174** · RF-101 — the phone rule accepts a Brazilian mobile however it's written (separators, `+55`/`55`, `0` trunk) and stores its 11 national digits; it names each failure: unknown DDD (`00`, `10`, `20`, `23`, `52`, `90`), landline (8 local digits starting 2–5, with or without prefixes), 11 digits not starting with 9, wrong length, another country, one repeated digit (`(99) 99999-9999`), stray characters (added 2026-10-28, user report: phone validation)
Proof: `vp test src/lib/phone/phone.test.ts`

**C17** · RF-503 — `encrypt` returns 39 bytes (`iv12 ‖ ct11 ‖ tag16`) that don't contain the 11 ASCII digits, two encryptions of one CPF differ (random IV), and `decrypt` returns the digits
Proof: `vp test src/server/lib/crypto/cpf-crypto.test.ts -t "round-trips without plaintext in the ciphertext"`

**C18** · RF-503 — `decrypt` throws under another CPF's blind index as AAD, and on a flipped ciphertext byte
Proof: `vp test src/server/lib/crypto/cpf-crypto.test.ts -t "refuses to decrypt under another blind index or after tampering"`

**C19** · RF-110 — `blindIndex` is equal for the same digits across calls and differs under another HMAC key
Proof: `vp test src/server/lib/crypto/cpf-crypto.test.ts -t "blind index is deterministic per key"`

**C20** · RF-802, RF-402 — `priceInstallment({ principalCents: 1_000_000, monthlyRate: "0.024900", termMonths: 12 })` → `{ installmentCents: 97428, totalCents: 1169136 }`
Proof: `vp test src/server/modules/pricing/price.test.ts -t "matches the PDF formula for 10.000 reais at 2,49% in 12x"`

**C21** · RF-802 — `priceInstallment` matches every row of the reference table below (36 rows: 3 principals × 12 lender rate/term pairs)
Proof: `vp test src/server/modules/pricing/price.test.ts -t "matches the reference table for every lender rate and term"`

**C22** · RF-802 — `totalCents` equals `installmentCents × termMonths` on every reference row
Proof: `vp test src/server/modules/pricing/price.test.ts -t "total equals installment times term"`

**C23** · RF-802 — `divRoundHalfUp` rounds exact halves up and everything below down: 5/2→3, 7/2→4, 4/3→1, 5/3→2, 0/7→0
Proof: `vp test src/server/modules/pricing/price.test.ts -t "rounds half up"`

## Reference table (exact rational PMT, half-up to the cent; computed independently, 2026-10-28)

Cells are `term: installment / total` in cents.

| PV (cents) | ALFA `0.024900`                                             | BETA `0.019900`                                              | GAMA `0.032900`                                             | DELTA `0.021900`                                             |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| 1 000 000  | 6: 181489/1088934 · 12: 97428/1169136 · 18: 69610/1252980   | 12: 94502/1134024 · 18: 66643/1199574 · 24: 52811/1267464    | 6: 186376/1118256 · 10: 118972/1189720 · 12: 102209/1226508 | 12: 95666/1147992 · 24: 54016/1296384 · 36: 40440/1455840    |
| 100 000    | 6: 18149/108894 · 12: 9743/116916 · 18: 6961/125298         | 12: 9450/113400 · 18: 6664/119952 · 24: 5281/126744          | 6: 18638/111828 · 10: 11897/118970 · 12: 10221/122652       | 12: 9567/114804 · 24: 5402/129648 · 36: 4044/145584          |
| 5 000 000  | 6: 907446/5444676 · 12: 487141/5845692 · 18: 348050/6264900 | 12: 472508/5670096 · 18: 333217/5997906 · 24: 264056/6337344 | 6: 931879/5591274 · 10: 594860/5948600 · 12: 511045/6132540 | 12: 478332/5739984 · 24: 270079/6481896 · 36: 202200/7279200 |
