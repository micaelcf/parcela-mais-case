import { CheckCircle2Icon, CircleSlashIcon, Loader2Icon, PlugZapIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import type { AttemptStatus } from "#/lib/enums";
import { formatBRL, formatRate } from "#/lib/money/money";
import type { AttemptView } from "#/server/modules/consultation/consultation.dto";

import { LENDER_NAME, REASON_TEXT, STATUS_LABEL } from "./lender-copy";

const STATUS_BADGE: Record<
  AttemptStatus,
  { icon: ReactNode; variant: "secondary" | "default" | "destructive" | "outline" }
> = {
  PENDING: {
    icon: <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />,
    variant: "secondary",
  },
  APPROVED: { icon: <CheckCircle2Icon aria-hidden />, variant: "default" },
  REFUSED: { icon: <CircleSlashIcon aria-hidden />, variant: "destructive" },
  UNAVAILABLE: { icon: <PlugZapIcon aria-hidden />, variant: "outline" },
};

function Detail({ attempt }: { attempt: AttemptView }) {
  if (attempt.status === "PENDING") {
    return <p className="text-muted-foreground">Aguardando a resposta da financeira…</p>;
  }
  if (attempt.status === "APPROVED" && attempt.approvedCents !== null) {
    return (
      <p>
        Até <strong className="font-semibold">{formatBRL(attempt.approvedCents)}</strong>
        {attempt.monthlyRate ? ` · ${formatRate(attempt.monthlyRate)}` : null}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground">
      {attempt.reason ? REASON_TEXT[attempt.reason] : "sem detalhes da financeira"}
    </p>
  );
}

/** One lender's live state. A polite live region, with a fixed height so updates never shift layout. */
export function LenderCard({ attempt }: { attempt: AttemptView }) {
  const name = LENDER_NAME[attempt.lender];
  const headingId = `lender-${attempt.lender.toLowerCase()}`;
  const badge = STATUS_BADGE[attempt.status];
  return (
    <Card
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby={headingId}
      data-lender={attempt.lender}
      data-status={attempt.status}
      className="h-32 gap-3"
    >
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle id={headingId}>{name}</CardTitle>
        <Badge variant={badge.variant}>
          {badge.icon}
          {STATUS_LABEL[attempt.status]}
        </Badge>
      </CardHeader>
      <CardContent className="text-sm">
        <Detail attempt={attempt} />
      </CardContent>
    </Card>
  );
}
