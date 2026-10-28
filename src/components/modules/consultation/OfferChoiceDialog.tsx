import { TriangleAlertIcon } from "lucide-react";

import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { formatBRL, formatRate } from "#/lib/money/money";
import type { OfferView } from "#/server/modules/consultation/consultation.dto";

type OfferChoiceDialogProps = {
  /** The offer to confirm; kept while the dialog animates out. */
  offer: OfferView | null;
  open: boolean;
  /** The choice is being sent: both buttons wait and the dialog stays open. */
  busy: boolean;
  /** Where focus goes on close: back to the row's button, or nowhere once the choice is shown. */
  returnFocus: boolean;
  onCancel: () => void;
  onConfirm: (offer: OfferView) => void;
};

/** The last step before choosing: the offer's figures and that the choice is final. */
export function OfferChoiceDialog({
  offer,
  open,
  busy,
  returnFocus,
  onCancel,
  onConfirm,
}: OfferChoiceDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent finalFocus={returnFocus} className="data-[size=default]:sm:max-w-md">
        {offer ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-heading text-lg font-semibold">
                Confirmar a escolha desta oferta?
              </AlertDialogTitle>
              <AlertDialogDescription>
                A escolha é definitiva: cada consulta aceita uma única oferta escolhida.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <LenderIdentity lender={offer.lender} size="lg" className="font-semibold" />
              <p className="text-xl font-semibold tabular-nums">
                {offer.termMonths}x de {formatBRL(offer.installmentCents)}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-medium tabular-nums">{formatBRL(offer.totalCents)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Taxa mensal</dt>
                  <dd className="font-medium tabular-nums">{formatRate(offer.monthlyRate)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Valor aprovado</dt>
                  <dd className="font-medium tabular-nums">{formatBRL(offer.approvedCents)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Valor solicitado</dt>
                  <dd className="font-medium tabular-nums">{formatBRL(offer.requestedCents)}</dd>
                </div>
              </dl>
              {offer.approvedBelowRequested ? (
                <p className="flex w-fit items-center gap-1.5 rounded-md bg-warning px-2 py-0.5 text-sm font-medium text-warning-foreground">
                  <TriangleAlertIcon aria-hidden className="size-4" />
                  valor aprovado menor que o solicitado
                </p>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={() => onConfirm(offer)}>
                {busy ? "Confirmando…" : "Confirmar escolha"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
