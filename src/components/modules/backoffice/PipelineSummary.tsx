import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatBRL } from "#/lib/money/money";
import type { PipelineMetrics } from "#/server/modules/backoffice/backoffice.dto";

import { formatCount, formatOptionalBRL, formatRatio } from "./backoffice-format";
import { MetricGrid, MetricTile } from "./MetricTile";

/** The money pipeline's totals and ratios (RF-604, RF-605), as the API computed them. */
export function PipelineTotals({ totals }: { totals: PipelineMetrics["totals"] }) {
  return (
    <MetricGrid label="Totais do período">
      <MetricTile
        label="Volume solicitado"
        value={formatBRL(totals.requestedCents)}
        hint={`${formatCount(totals.consultations)} consultas`}
      />
      <MetricTile
        label="Volume aprovado"
        value={formatBRL(totals.approvedCents)}
        hint={`${formatCount(totals.approvedConsultations)} consultas com aprovação`}
      />
      <MetricTile
        label="Volume escolhido"
        value={formatBRL(totals.chosenCents)}
        hint={`${formatCount(totals.chosenOffers)} ofertas escolhidas`}
      />
      <MetricTile
        label="Taxa de aprovação"
        value={formatRatio(totals.approvalRate)}
        hint={`${formatCount(totals.settledConsultations)} consultas concluídas`}
      />
      <MetricTile
        label="Aprovado / solicitado"
        value={formatRatio(totals.approvedRequestedRatio)}
      />
      <MetricTile
        label="Parcela média escolhida"
        value={formatOptionalBRL(totals.avgChosenInstallmentCents)}
      />
      <MetricTile
        label="Total médio escolhido"
        value={formatOptionalBRL(totals.avgChosenTotalCents)}
      />
    </MetricGrid>
  );
}

/** Chosen volume per lender (RF-605). */
export function ChosenByLenderTable({ rows }: { rows: PipelineMetrics["chosenByLender"] }) {
  return (
    <Table>
      <TableCaption className="sr-only">Volume escolhido por financeira</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Financeira</TableHead>
          <TableHead scope="col" className="text-right">
            Ofertas escolhidas
          </TableHead>
          <TableHead scope="col" className="text-right">
            Volume escolhido
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.lender}>
            <TableHead scope="row" className="font-medium">
              <LenderIdentity lender={row.lender} size="sm" />
            </TableHead>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.chosenOffers)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatBRL(row.chosenCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
