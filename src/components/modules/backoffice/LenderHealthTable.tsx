import { LENDER_NAME } from "#/components/modules/consultation/lender-copy";
import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import { Badge } from "#/components/ui/badge";
import { Switch } from "#/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { LenderCode } from "#/lib/enums";
import type { BREAKER_STATES, LenderHealth } from "#/server/modules/backoffice/backoffice.dto";

import { formatCount, formatMs, formatRatio } from "./backoffice-format";

type BreakerState = (typeof BREAKER_STATES)[number];

const BREAKER: Record<
  BreakerState,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  CLOSED: { label: "Fechado", variant: "secondary" },
  OPEN: { label: "Aberto", variant: "destructive" },
  HALF_OPEN: { label: "Meio-aberto", variant: "outline" },
};

/**
 * Per-lender health (RF-606, RF-607, RF-610): kill-switch and circuit state, queue backlog,
 * latency percentiles and outcome rates. With `onToggle`, each row gets its kill switch (RF-608).
 */
export function LenderHealthTable({
  lenders,
  onToggle,
  pendingLender = null,
}: {
  lenders: LenderHealth[];
  onToggle?: (lender: LenderCode, enabled: boolean) => void;
  pendingLender?: LenderCode | null;
}) {
  return (
    <Table>
      <TableCaption className="sr-only">Saúde das financeiras</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Financeira</TableHead>
          <TableHead scope="col">Situação</TableHead>
          <TableHead scope="col">Disjuntor</TableHead>
          <TableHead scope="col" className="text-right">
            Fila
          </TableHead>
          <TableHead scope="col" className="text-right">
            p50
          </TableHead>
          <TableHead scope="col" className="text-right">
            p95
          </TableHead>
          <TableHead scope="col" className="text-right">
            Aprovação
          </TableHead>
          <TableHead scope="col" className="text-right">
            Recusa
          </TableHead>
          <TableHead scope="col" className="text-right">
            Erro
          </TableHead>
          <TableHead scope="col" className="text-right">
            Timeout
          </TableHead>
          <TableHead scope="col" className="text-right">
            Respostas
          </TableHead>
          {onToggle ? <TableHead scope="col">Ativa</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lenders.map((lender) => {
          const name = LENDER_NAME[lender.lender];
          const breaker = BREAKER[lender.breaker];
          return (
            <TableRow key={lender.lender} data-lender={lender.lender}>
              <TableHead scope="row" className="font-medium">
                <LenderIdentity lender={lender.lender} size="sm" />
              </TableHead>
              <TableCell>
                <Badge variant={lender.enabled ? "secondary" : "destructive"}>
                  {lender.enabled ? "Ativa" : "Desativada"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={breaker.variant}>{breaker.label}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(lender.queueBacklog)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMs(lender.p50LatencyMs)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMs(lender.p95LatencyMs)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRatio(lender.approvalRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRatio(lender.refusalRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRatio(lender.errorRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRatio(lender.timeoutRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(lender.settledAttempts)}
              </TableCell>
              {onToggle ? (
                <TableCell>
                  <Switch
                    aria-label={`${name} ativa`}
                    checked={lender.enabled}
                    disabled={pendingLender !== null}
                    onCheckedChange={(checked) => onToggle(lender.lender, checked)}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
