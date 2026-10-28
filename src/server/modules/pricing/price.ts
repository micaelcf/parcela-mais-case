/**
 * Tabela Price, exact: the rate string is read as the rational N / D and the installment
 * PV·N·(D+N)^n / (D·((D+N)^n − D^n)) is computed in BigInt, rounded half-up to the cent.
 */

const RATE_SHAPE = /^(\d+)(?:\.(\d+))?$/;

/** `num / den` rounded half-up, for `num ≥ 0` and `den > 0`. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("divRoundHalfUp needs a positive denominator");
  if (num < 0n) throw new RangeError("divRoundHalfUp needs a non-negative numerator");
  return (2n * num + den) / (2n * den);
}

/** `"0.024900"` → `{ N: 24900n, D: 1000000n }`. */
function parseRate(monthlyRate: string): { N: bigint; D: bigint } {
  const match = RATE_SHAPE.exec(monthlyRate);
  if (!match) throw new RangeError(`Invalid monthly rate: ${monthlyRate}`);
  const [, whole = "0", fraction = ""] = match;
  const D = 10n ** BigInt(fraction.length);
  return { N: BigInt(whole) * D + BigInt(fraction || "0"), D };
}

export function priceInstallment(input: {
  principalCents: number;
  monthlyRate: string;
  termMonths: number;
}): {
  installmentCents: number;
  totalCents: number; // installmentCents × termMonths
} {
  const { principalCents, monthlyRate, termMonths } = input;
  if (!Number.isSafeInteger(principalCents) || principalCents < 0) {
    throw new RangeError(`Invalid principal: ${principalCents}`);
  }
  if (!Number.isSafeInteger(termMonths) || termMonths < 1) {
    throw new RangeError(`Invalid term: ${termMonths}`);
  }
  const { N, D } = parseRate(monthlyRate);
  const PV = BigInt(principalCents);
  const n = BigInt(termMonths);

  let installment: bigint;
  if (N === 0n) {
    installment = divRoundHalfUp(PV, n);
  } else {
    const a = (D + N) ** n;
    const b = D ** n;
    installment = divRoundHalfUp(PV * N * a, D * (a - b));
  }

  return { installmentCents: Number(installment), totalCents: Number(installment * n) };
}
