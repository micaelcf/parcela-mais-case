import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { UserPlusIcon } from "lucide-react";

import { buttonVariants } from "#/components/ui/button";
import type {
  ConsultationPublicView,
  JourneyStatus,
  OfferView,
} from "#/server/modules/consultation/consultation.dto";
import { formatBRL } from "#/lib/money/money";

import { ChoiceConfirmation } from "./ChoiceConfirmation";
import { LenderCard } from "./LenderCard";
import { NoOfferPanel } from "./NoOfferPanel";
import { OfferList } from "./OfferList";

const JOURNEY_HEADLINE: Record<JourneyStatus, string> = {
  QUOTING: "Consultando as financeiras…",
  OFFERS: "Compare as ofertas e escolha a melhor",
  NO_OFFER: "Nenhuma oferta desta vez",
  CHOSEN: "Oferta escolhida",
};

type ConsultationJourneyProps = {
  view: ConsultationPublicView;
  choosingOfferId: string | null;
  /** The user chose in this visit: the confirmation takes focus. */
  justChose: boolean;
  requoting: boolean;
  /** Sends the choice; resolves whether it was recorded. */
  onChoose: (offer: OfferView) => Promise<boolean>;
  onRequote: (treatmentAmountCents: number) => void;
};

export function ConsultationJourney({
  view,
  choosingOfferId,
  justChose,
  requoting,
  onChoose,
  onRequote,
}: ConsultationJourneyProps) {
  const chosen = view.choice
    ? (view.offers.find((offer) => offer.id === view.choice?.offerId) ?? null)
    : null;
  const pending = view.attempts.filter((attempt) => attempt.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {view.patientFirstName ? `${view.patientFirstName} · ` : null}valor solicitado{" "}
            <strong className="text-foreground">{formatBRL(view.treatmentAmountCents)}</strong>
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {JOURNEY_HEADLINE[view.journeyStatus]}
          </h1>
          <p className="min-h-5 text-sm text-muted-foreground">
            {pending > 0
              ? `${pending} de ${view.attempts.length} financeiras ainda respondendo.`
              : "Todas as financeiras responderam ou o prazo terminou."}
          </p>
        </div>
        {/* Back to the start: the signup layout mounts afresh (empty form, new idempotency key). */}
        <Link
          to="/cadastro/paciente"
          className={cn(buttonVariants({ variant: "outline", className: "self-start" }))}
        >
          <UserPlusIcon aria-hidden data-icon="inline-start" />
          Novo cadastro
        </Link>
      </header>

      <section aria-labelledby="lenders-heading" className="flex flex-col gap-3">
        <h2 id="lenders-heading" className="text-lg font-semibold">
          Financeiras
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.attempts.map((attempt) => (
            <LenderCard key={attempt.lender} attempt={attempt} />
          ))}
        </div>
      </section>

      {chosen ? <ChoiceConfirmation offer={chosen} focus={justChose} /> : null}

      {view.offers.length > 0 ? (
        <OfferList view={view} choosingOfferId={choosingOfferId} onChoose={onChoose} />
      ) : view.journeyStatus === "NO_OFFER" ? (
        <NoOfferPanel view={view} requoting={requoting} onRequote={onRequote} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          As ofertas aparecem aqui assim que uma financeira aprovar.
        </p>
      )}
    </div>
  );
}
