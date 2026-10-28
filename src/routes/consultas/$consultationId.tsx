import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { chooseOffer, getConsultation, requoteConsultation } from "#/api/consultations";
import { AppShell } from "#/components/AppShell";
import { ConsultationJourney } from "#/components/modules/consultation/ConsultationJourney";
import { buttonVariants } from "#/components/ui/button";
import { useConsultationStream } from "#/hooks/use-consultation-stream";
import type {
  ConsultationPublicView,
  OfferView,
} from "#/server/modules/consultation/consultation.dto";

export const Route = createFileRoute("/consultas/$consultationId")({
  loader: async ({ params }) => {
    const view = await getConsultation(params.consultationId);
    if (!view) throw notFound();
    return view;
  },
  component: ConsultationPage,
  notFoundComponent: ConsultationNotFound,
});

function ConsultationPage() {
  const view = Route.useLoaderData();
  // A new consultation (after a requote) starts a fresh live view.
  return (
    <AppShell>
      <LiveConsultation key={view.id} initial={view} />
    </AppShell>
  );
}

function LiveConsultation({ initial }: { initial: ConsultationPublicView }) {
  const view = useConsultationStream(initial);
  const router = useRouter();
  const navigate = useNavigate();
  const [choosingOfferId, setChoosingOfferId] = useState<string | null>(null);
  const [justChose, setJustChose] = useState(false);
  const [requoting, setRequoting] = useState(false);
  const [requoteKey] = useState(() => crypto.randomUUID());

  async function choose(offer: OfferView) {
    setChoosingOfferId(offer.id);
    const result = await chooseOffer(view.id, offer.id);
    setChoosingOfferId(null);
    if (!result.ok) {
      toast.error(result.problem.title, { description: result.problem.detail });
      await router.invalidate();
      return;
    }
    setJustChose(true);
    toast.success("Oferta escolhida");
    await router.invalidate();
  }

  async function requote(treatmentAmountCents: number) {
    setRequoting(true);
    const result = await requoteConsultation(view.id, { treatmentAmountCents }, requoteKey);
    if (!result.ok) {
      setRequoting(false);
      toast.error(result.problem.title, { description: result.problem.detail });
      return;
    }
    await navigate({
      to: "/consultas/$consultationId",
      params: { consultationId: result.value.id },
    });
  }

  return (
    <ConsultationJourney
      view={view}
      choosingOfferId={choosingOfferId}
      justChose={justChose}
      requoting={requoting}
      onChoose={(offer) => void choose(offer)}
      onRequote={(amount) => void requote(amount)}
    />
  );
}

function ConsultationNotFound() {
  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4">
        <h1 className="font-heading text-2xl font-semibold">Consulta não encontrada</h1>
        <p className="text-muted-foreground">Confira o endereço ou comece um novo cadastro.</p>
        <Link to="/cadastro/paciente" className={buttonVariants({ size: "lg" })}>
          Novo cadastro
        </Link>
      </div>
    </AppShell>
  );
}
