import { CheckIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { formatBRL, formatRate } from "#/lib/money/money";
import type {
  ConsultationPublicView,
  OfferView,
} from "#/server/modules/consultation/consultation.dto";

import { LENDER_NAME } from "./lender-copy";
import { OfferChoiceDialog } from "./OfferChoiceDialog";
import {
  groupOffersByLender,
  type LenderOfferGroup,
  OFFER_SORTS,
  type OfferSort,
} from "./sort-offers";

const SORT_LABEL: Record<OfferSort, string> = {
  installment: "Menor parcela",
  total: "Menor custo total",
};

/** A group's best offer under the current sort, as its header hint. */
const BEST_HINT: Record<OfferSort, (offer: OfferView) => string> = {
  installment: (offer) =>
    `a partir de ${offer.termMonths}x de ${formatBRL(offer.installmentCents)}`,
  total: (offer) => `a partir de ${formatBRL(offer.totalCents)} no total`,
};

type OfferListProps = {
  view: ConsultationPublicView;
  /** The offer whose choice is being sent, if any. */
  choosingOfferId: string | null;
  /** Sends the choice; resolves whether it was recorded. */
  onChoose: (offer: OfferView) => Promise<boolean>;
};

type RowState = {
  chosenId: string | null;
  /** Some choice is being sent: every button waits. */
  busy: boolean;
  onPick: (offer: OfferView) => void;
};

function OfferRow({ offer, state }: { offer: OfferView; state: RowState }) {
  const chosen = offer.id === state.chosenId;
  return (
    <li
      data-lender={offer.lender}
      data-term={offer.termMonths}
      data-chosen={chosen || undefined}
      className="flex flex-col gap-3 rounded-lg border p-4 transition-colors focus-within:border-ring/60 hover:border-foreground/25 not-data-chosen:focus-within:bg-muted/50 not-data-chosen:hover:bg-muted/50 motion-reduce:transition-none data-chosen:border-primary data-chosen:bg-accent sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold tabular-nums">
          {offer.termMonths}x de {formatBRL(offer.installmentCents)}
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
      ) : state.chosenId === null ? (
        <Button
          size="lg"
          variant="outline"
          disabled={state.busy}
          onClick={() => state.onPick(offer)}
          aria-label={`Escolher ${LENDER_NAME[offer.lender]} em ${offer.termMonths}x de ${formatBRL(offer.installmentCents)}`}
        >
          Escolher
        </Button>
      ) : null}
    </li>
  );
}

/** One lender's offers, open until the user collapses it; the header names its best offer. */
function LenderGroup({
  group,
  sort,
  state,
}: {
  group: LenderOfferGroup;
  sort: OfferSort;
  state: RowState;
}) {
  const count = group.offers.length;
  return (
    <Collapsible defaultOpen data-lender-group={group.lender} className="flex flex-col gap-2">
      <h3>
        <CollapsibleTrigger className="group/trigger flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LenderIdentity lender={group.lender} size="lg" className="text-base font-semibold" />
            <span className="text-sm text-muted-foreground tabular-nums">
              {count} {count === 1 ? "oferta" : "ofertas"} · {BEST_HINT[sort](group.offers[0])}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <ul aria-label={`Ofertas ${LENDER_NAME[group.lender]}`} className="flex flex-col gap-3">
          {group.offers.map((offer) => (
            <OfferRow key={offer.id} offer={offer} state={state} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Every offer grouped by lender, sortable by lowest installment or lowest total (rows within a
 * group, groups by their best offer); choosing goes through a confirmation dialog.
 */
export function OfferList({ view, choosingOfferId, onChoose }: OfferListProps) {
  const [sort, setSort] = useState<OfferSort>("installment");
  const [picked, setPicked] = useState<OfferView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const groups = groupOffersByLender(view.offers, sort);
  const chosenId = view.choice?.offerId ?? null;
  const busy = choosingOfferId !== null;

  async function confirm(offer: OfferView) {
    if (await onChoose(offer)) setConfirming(false);
  }

  const rowState: RowState = {
    chosenId,
    busy,
    onPick: (offer) => {
      setPicked(offer);
      setConfirming(true);
    },
  };

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
              const option = OFFER_SORTS.find((candidate) => candidate === next[0]);
              if (option) setSort(option);
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
      <CardContent className="flex flex-col gap-4">
        {groups.map((group) => (
          <LenderGroup key={group.lender} group={group} sort={sort} state={rowState} />
        ))}
      </CardContent>
      <OfferChoiceDialog
        offer={picked}
        open={confirming && chosenId === null}
        busy={busy}
        returnFocus={chosenId === null}
        onCancel={() => setConfirming(false)}
        onConfirm={(offer) => void confirm(offer)}
      />
    </Card>
  );
}
