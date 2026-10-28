import { CircleCheckBigIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { formatBRL, formatRate } from "#/lib/money/money";
import type { OfferView } from "#/server/modules/consultation/consultation.dto";

import { LENDER_NAME } from "./lender-copy";

/** The persisted choice. Takes focus when it appears right after the user chose. */
export function ChoiceConfirmation({ offer, focus }: { offer: OfferView; focus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);

  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      className="border-primary bg-accent text-accent-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <CircleCheckBigIcon aria-hidden />
      <AlertTitle>
        <h2>Oferta escolhida</h2>
      </AlertTitle>
      <AlertDescription className="text-accent-foreground">
        <p>
          {LENDER_NAME[offer.lender]} · {offer.termMonths}x de {formatBRL(offer.installmentCents)} ·
          total {formatBRL(offer.totalCents)} · {formatRate(offer.monthlyRate)}
        </p>
        <p>A escolha foi registrada. A clínica vai seguir com a contratação.</p>
      </AlertDescription>
    </Alert>
  );
}
