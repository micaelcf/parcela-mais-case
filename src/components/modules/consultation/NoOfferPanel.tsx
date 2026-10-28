import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";

import { LenderIdentity } from "#/components/modules/lender/LenderIdentity";
import { discardSignupDraft } from "#/components/modules/signup/signup-draft";
import { Button, buttonVariants } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { formatBRL } from "#/lib/money/money";
import type { ConsultationPublicView } from "#/server/modules/consultation/consultation.dto";

import { REASON_TEXT, STATUS_LABEL } from "./lender-copy";

type NoOfferPanelProps = {
  view: ConsultationPublicView;
  requoting: boolean;
  onRequote: (treatmentAmountCents: number) => void;
};

/** No lender approved: each lender's outcome in plain terms, and the hinted lower amount to retry with. */
export function NoOfferPanel({ view, requoting, onRequote }: NoOfferPanelProps) {
  const suggested = view.suggestion?.treatmentAmountCents ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <InfoIcon aria-hidden className="size-5 text-muted-foreground" />
            Nenhuma financeira aprovou {formatBRL(view.treatmentAmountCents)}
          </h2>
        </CardTitle>
        <CardDescription>Veja o que cada financeira respondeu.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ul className="flex flex-col gap-1.5 text-sm">
          {view.attempts.map((attempt) => (
            <li key={attempt.lender} className="flex flex-wrap items-center gap-x-1.5">
              <span className="font-medium">
                <LenderIdentity lender={attempt.lender} size="sm" />:
              </span>
              <span>
                {STATUS_LABEL[attempt.status]}
                {attempt.reason ? ` · ${REASON_TEXT[attempt.reason]}` : null}
              </span>
            </li>
          ))}
        </ul>
        {suggested === null ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">
              Nenhuma financeira indicou um valor menor que poderia aprovar.
            </p>
            <Link
              to="/cadastro/paciente"
              onClick={discardSignupDraft}
              className={buttonVariants({ variant: "outline" })}
            >
              Começar um novo cadastro
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-primary/40 bg-accent p-4">
            <p className="text-accent-foreground">
              Sugestão: simular com <strong>{formatBRL(suggested)}</strong>, um valor que ao menos
              uma financeira indicou que poderia aprovar.
            </p>
            <Button size="lg" disabled={requoting} onClick={() => onRequote(suggested)}>
              {requoting ? "Simulando…" : `Simular com ${formatBRL(suggested)}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
