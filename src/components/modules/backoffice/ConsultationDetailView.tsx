import {
  LENDER_NAME,
  REASON_TEXT,
  STATUS_LABEL,
} from "#/components/modules/consultation/lender-copy";
import { maskCep, maskCpf, maskPhone } from "#/components/modules/signup/masks";
import { Badge } from "#/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { AttemptStatus } from "#/lib/enums";
import { formatBRL, formatRate } from "#/lib/money/money";
import type { ConsultationDetail } from "#/server/modules/backoffice/backoffice.dto";

import {
  EMPTY,
  formatCalendarDate,
  formatDateTime,
  formatMs,
  formatOptionalBRL,
  QUOTE_STATUS_LABEL,
  SCENARIO_LABEL,
} from "./backoffice-format";
import { JourneyStatusBadge } from "./ConsultationTable";
import { Section } from "./PageHeader";

const ATTEMPT_VARIANT: Record<AttemptStatus, "secondary" | "outline" | "destructive" | "default"> =
  {
    PENDING: "outline",
    APPROVED: "default",
    REFUSED: "secondary",
    UNAVAILABLE: "destructive",
  };

type PatientAddress = ConsultationDetail["patient"]["address"];

/** The patient's address as label/value pairs; `—` throughout for patients saved before addresses. */
function addressFacts(address: PatientAddress): Array<{ label: string; value: string }> {
  return [
    { label: "CEP", value: address ? maskCep(address.cep) : EMPTY },
    {
      label: "Endereço",
      value: address
        ? `${address.street}, ${address.number}${address.complement ? ` – ${address.complement}` : ""}`
        : EMPTY,
    },
    { label: "Bairro", value: address?.neighborhood ?? EMPTY },
    { label: "Cidade/UF", value: address ? `${address.city}/${address.state}` : EMPTY },
  ];
}

/** Label/value pairs as one description list. */
function Facts({ items }: { items: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Everything about one consultation for the operator (RF-612): the full patient incl. the
 * decrypted CPF, the inputs frozen at submission, each lender attempt's timeline, offers and choice.
 */
export function ConsultationDetailView({ detail }: { detail: ConsultationDetail }) {
  const chosenOfferId = detail.choice?.offerId ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Consulta">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <JourneyStatusBadge status={detail.status} />
            <Badge variant="outline">
              Cotação {QUOTE_STATUS_LABEL[detail.quoteStatus].toLowerCase()}
            </Badge>
            <Badge variant="outline">Cenário: {SCENARIO_LABEL[detail.simulationScenario]}</Badge>
          </div>
          <Facts
            items={[
              { label: "ID", value: detail.id },
              { label: "Criada em", value: formatDateTime(detail.createdAt) },
              { label: "Prazo das financeiras", value: formatDateTime(detail.deadlineAt) },
              { label: "Concluída em", value: formatDateTime(detail.settledAt) },
            ]}
          />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Paciente">
          <Facts
            items={[
              { label: "Nome completo", value: detail.patient.fullName },
              { label: "CPF", value: maskCpf(detail.patient.cpf) },
              { label: "Data de nascimento", value: formatCalendarDate(detail.patient.birthdate) },
              { label: "Celular", value: maskPhone(detail.patient.phone) },
              ...addressFacts(detail.patient.address),
              { label: "Paciente desde", value: formatDateTime(detail.patient.createdAt) },
              { label: "Atualizado em", value: formatDateTime(detail.patient.updatedAt) },
            ]}
          />
        </Section>
        <Section title="Dados enviados" description="Como estavam no momento da consulta.">
          <Facts
            items={[
              { label: "Renda mensal", value: formatBRL(detail.inputs.monthlyIncomeCents) },
              {
                label: "Valor do tratamento",
                value: formatBRL(detail.inputs.treatmentAmountCents),
              },
              { label: "Data de nascimento", value: formatCalendarDate(detail.inputs.birthdate) },
              { label: "Idade", value: `${detail.inputs.ageYears} anos` },
            ]}
          />
        </Section>
      </div>

      <Section title="Financeiras" description="Linha do tempo de cada tentativa.">
        <ol className="grid gap-4 md:grid-cols-2">
          {detail.attempts.map((attempt) => (
            <li key={attempt.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-heading font-semibold">{LENDER_NAME[attempt.lender]}</h3>
                <div className="flex gap-2">
                  {attempt.breakerProbe ? <Badge variant="outline">Sondagem</Badge> : null}
                  <Badge variant={ATTEMPT_VARIANT[attempt.status]}>
                    {STATUS_LABEL[attempt.status]}
                  </Badge>
                </div>
              </div>
              {attempt.reason ? (
                <p className="text-sm text-muted-foreground">
                  Motivo: {REASON_TEXT[attempt.reason]}
                </p>
              ) : null}
              <Facts
                items={[
                  { label: "Valor aprovado", value: formatOptionalBRL(attempt.approvedCents) },
                  {
                    label: "Taxa mensal",
                    value: attempt.monthlyRate ? formatRate(attempt.monthlyRate) : EMPTY,
                  },
                  {
                    label: "Máximo aprovável",
                    value: formatOptionalBRL(attempt.maxApprovableCents),
                  },
                  { label: "Latência", value: formatMs(attempt.latencyMs) },
                ]}
              />
              <ol
                aria-label={`Linha do tempo: ${LENDER_NAME[attempt.lender]}`}
                className="flex flex-col gap-1 border-l pl-3 text-sm"
              >
                <TimelineStep label="Criada" at={attempt.createdAt} />
                <TimelineStep label="Na fila" at={attempt.pickedAt} />
                <TimelineStep label="Chamada" at={attempt.calledAt} />
                <TimelineStep label="Concluída" at={attempt.settledAt} />
              </ol>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Ofertas"
        description={
          detail.choice
            ? `Oferta escolhida em ${formatDateTime(detail.choice.chosenAt)}.`
            : "Nenhuma oferta escolhida."
        }
      >
        <Table>
          <TableCaption className="sr-only">Ofertas da consulta</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Financeira</TableHead>
              <TableHead scope="col" className="text-right">
                Aprovado
              </TableHead>
              <TableHead scope="col" className="text-right">
                Taxa
              </TableHead>
              <TableHead scope="col" className="text-right">
                Prazo
              </TableHead>
              <TableHead scope="col" className="text-right">
                Parcela
              </TableHead>
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
              <TableHead scope="col">Escolha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.offers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-16 text-center text-muted-foreground">
                  Nenhuma oferta.
                </TableCell>
              </TableRow>
            ) : (
              detail.offers.map((offer) => (
                <TableRow key={offer.id}>
                  <TableHead scope="row" className="font-medium">
                    {LENDER_NAME[offer.lender]}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(offer.approvedCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(offer.monthlyRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{offer.termMonths}x</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(offer.installmentCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(offer.totalCents)}
                  </TableCell>
                  <TableCell>
                    {offer.id === chosenOfferId ? <Badge>Escolhida</Badge> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}

function TimelineStep({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{at ? formatDateTime(at) : EMPTY}</span>
    </li>
  );
}
