import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { getConsultationDetail } from "#/api/backoffice";
import { ConsultationDetailView } from "#/components/modules/backoffice/ConsultationDetailView";
import { PageHeader } from "#/components/modules/backoffice/PageHeader";
import { ErrorPage } from "#/components/modules/error/ErrorPage";
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

function BackToList({ primary = false }: { primary?: boolean }) {
  return (
    <Link
      to="/backoffice/consultas"
      className={buttonVariants({
        variant: primary ? "default" : "outline",
        size: primary ? "lg" : "default",
      })}
    >
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
    <ErrorPage
      status={404}
      title="Consulta não encontrada"
      description="Confira o endereço ou volte para a lista."
      action={<BackToList primary />}
    />
  );
}
