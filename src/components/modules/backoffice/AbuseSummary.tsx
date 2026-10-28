import { Link } from "@tanstack/react-router";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { AbuseMetrics } from "#/server/modules/backoffice/backoffice.dto";

import { formatCount, LIMIT_LABEL } from "./backoffice-format";
import { MetricGrid, MetricTile } from "./MetricTile";

/** Limit hits and 429s in the window (RF-614). */
export function AbuseTotals({ metrics }: { metrics: AbuseMetrics }) {
  return (
    <MetricGrid label="Limites no período">
      <MetricTile label="Requisições contadas" value={formatCount(metrics.requests)} />
      <MetricTile label="Respostas 429" value={formatCount(metrics.tooManyRequests)} />
      <MetricTile label={LIMIT_LABEL.IP_LIMIT} value={formatCount(metrics.limitHits.IP_LIMIT)} />
      <MetricTile
        label={LIMIT_LABEL.PATIENT_LIMIT}
        value={formatCount(metrics.limitHits.PATIENT_LIMIT)}
      />
    </MetricGrid>
  );
}

/** Patients with the most consultations: first name only, never the CPF. */
export function TopPatientsTable({ rows }: { rows: AbuseMetrics["topPatients"] }) {
  return (
    <Table>
      <TableCaption className="sr-only">Pacientes com mais consultas</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Paciente</TableHead>
          <TableHead scope="col" className="text-right">
            Consultas
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={2} />
        ) : (
          rows.map((row) => (
            <TableRow key={row.patientId}>
              <TableHead scope="row" className="font-medium">
                <Link
                  to="/backoffice/consultas"
                  search={{ patientId: row.patientId }}
                  className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {row.firstName}
                </Link>
              </TableHead>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.consultations)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

/** Client IPs (hash prefix only) with the most counted requests. */
export function TopIpsTable({ rows }: { rows: AbuseMetrics["topIps"] }) {
  return (
    <Table>
      <TableCaption className="sr-only">IPs com mais requisições</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">IP (hash)</TableHead>
          <TableHead scope="col" className="text-right">
            Requisições
          </TableHead>
          <TableHead scope="col" className="text-right">
            Respostas 429
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={3} />
        ) : (
          rows.map((row) => (
            <TableRow key={row.ipHash}>
              <TableHead scope="row" className="font-mono font-medium">
                {row.ipHash}
              </TableHead>
              <TableCell className="text-right tabular-nums">{formatCount(row.requests)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.tooManyRequests)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-16 text-center text-muted-foreground">
        Nada no período.
      </TableCell>
    </TableRow>
  );
}
