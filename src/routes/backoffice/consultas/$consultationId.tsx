import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon } from "lucide-react";

import { getConsultationDetail } from "#/api/backoffice";
import { ConsultationDetailView } from "#/components/modules/backoffice/ConsultationDetailView";
import { PageHeader } from "#/components/modules/backoffice/PageHeader";
import { buttonVariants } from "#/components/ui/button";

export const Route = createFileRoute("/backoffice/consultas/$consultationId")({
  loader: async ({ params }) => {
    const detail = await getConsultationDetail(params.consultationId);
    if (!detail) throw notFound();
    return detail;
  },
  component: ConsultationDetailPage,
  notFoundComponent: ConsultationNotFound,
});

function BackToList() {
  return (
    <Link to="/backoffice/consultas" className={cn(buttonVariants({ variant: "outline" }))}>
      <ArrowLeftIcon aria-hidden data-icon="inline-start" />
      Voltar para consultas
    </Link>
  );
}

function ConsultationDetailPage() {
  const detail = Route.useLoaderData();
  return (
    <>
      <PageHeader
        title={`Consulta de ${detail.patient.fullName}`}
        description="Dados completos do paciente, inclusive o CPF. Uso restrito à operação."
        actions={<BackToList />}
      />
      <ConsultationDetailView detail={detail} />
    </>
  );
}

function ConsultationNotFound() {
  return (
    <PageHeader
      title="Consulta não encontrada"
      description="Confira o endereço ou volte para a lista."
      actions={<BackToList />}
    />
  );
}
