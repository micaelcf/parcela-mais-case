import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { formatBRL, formatRate } from "#/lib/money/money";
import type {
  ConsultationPublicView,
  OfferView,
} from "#/server/modules/consultation/consultation.dto";

import { LENDER_NAME } from "./lender-copy";
import { OFFER_SORTS, type OfferSort, sortOffers } from "./sort-offers";

const SORT_LABEL: Record<OfferSort, string> = {
  installment: "Menor parcela",
  total: "Menor custo total",
};

type OfferListProps = {
  view: ConsultationPublicView;
  /** The offer whose choice is being sent, if any. */
  choosingOfferId: string | null;
  onChoose: (offer: OfferView) => void;
};

function OfferRow({
  offer,
  chosen,
  canChoose,
  busy,
  choosing,
  onChoose,
}: {
  offer: OfferView;
  chosen: boolean;
  canChoose: boolean;
  /** Some choice is being sent: every button waits. */
  busy: boolean;
  /** This row's choice is being sent. */
  choosing: boolean;
  onChoose: (offer: OfferView) => void;
}) {
  const name = LENDER_NAME[offer.lender];
  return (
    <li
      data-lender={offer.lender}
      data-term={offer.termMonths}
      data-chosen={chosen || undefined}
      className="flex flex-col gap-3 rounded-lg border p-4 data-chosen:border-primary data-chosen:bg-accent sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{name}</span>
          <span className="text-lg font-semibold tabular-nums">
            {offer.termMonths}x de {formatBRL(offer.installmentCents)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          Total {formatBRL(offer.totalCents)} · {formatRate(offer.monthlyRate)} · Valor aprovado{" "}
          {formatBRL(offer.approvedCents)}
        </p>
        {offer.approvedBelowRequested ? (
          <p className="flex w-fit items-center gap-1.5 rounded-md bg-warning px-2 py-0.5 text-sm font-medium text-warning-foreground">
            <TriangleAlertIcon aria-hidden className="size-4" />
            valor aprovado menor que o solicitado
          </p>
        ) : null}
      </div>
      {chosen ? (
        <Badge className="self-start sm:self-center">
          <CheckIcon aria-hidden />
          Escolhida
        </Badge>
      ) : canChoose ? (
        <Button
          size="lg"
          variant="outline"
          disabled={busy}
          onClick={() => onChoose(offer)}
          aria-label={`Escolher ${name} em ${offer.termMonths}x de ${formatBRL(offer.installmentCents)}`}
        >
          {choosing ? "Escolhendo…" : "Escolher"}
        </Button>
      ) : null}
    </li>
  );
}

/** Every offer as one row, sortable by lowest installment or lowest total; the chosen one marked. */
export function OfferList({ view, choosingOfferId, onChoose }: OfferListProps) {
  const [sort, setSort] = useState<OfferSort>("installment");
  const offers = sortOffers(view.offers, sort);
  const chosenId = view.choice?.offerId ?? null;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>
            <h2 id="offers-heading">Ofertas</h2>
          </CardTitle>
          <CardDescription>
            Parcelas pela Tabela Price, calculadas por cada financeira.
          </CardDescription>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="offer-sort-label" className="text-sm font-medium">
            Ordenar por
          </span>
          <ToggleGroup
            aria-labelledby="offer-sort-label"
            variant="outline"
            value={[sort]}
            onValueChange={(next) => {
              const picked = OFFER_SORTS.find((option) => option === next[0]);
              if (picked) setSort(picked);
            }}
          >
            {OFFER_SORTS.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {SORT_LABEL[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <ul aria-labelledby="offers-heading" className="flex flex-col gap-3">
          {offers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              chosen={offer.id === chosenId}
              canChoose={chosenId === null}
              busy={choosingOfferId !== null}
              choosing={choosingOfferId === offer.id}
              onChoose={onChoose}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
