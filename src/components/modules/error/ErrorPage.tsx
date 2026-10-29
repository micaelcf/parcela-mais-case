import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { HouseIcon, RotateCwIcon } from "lucide-react";
import { type ReactNode, use, useEffect, useRef, useState } from "react";

import { AppShell } from "#/components/AppShell";
import { ShellContext } from "#/components/shell-context";
import { Button, buttonVariants } from "#/components/ui/button";

import { errorCopyOf } from "./error-status";
import { StatusDigits } from "./StatusDigits";

type ErrorPageProps = {
  status: number;
  /** Override the status's default heading and text (`error-status.ts`). */
  title?: string;
  description?: string;
  /** Re-runs the failed loads; offered only when the status is worth retrying. */
  onRetry?: () => Promise<void>;
  /** Replaces the default way out (the start of the current area). */
  action?: ReactNode;
  /** The error behind it, shown in development builds only. */
  details?: string;
};

/**
 * A full error page for a route: the status, what happened in plain words, and a way on. In place
 * of a route that brings its own frame it adds the public one; inside a frame it fits in.
 */
export function ErrorPage(props: ErrorPageProps) {
  const content = <ErrorContent {...props} />;
  return use(ShellContext) ? content : <AppShell>{content}</AppShell>;
}

function ErrorContent({ status, title, description, onRetry, action, details }: ErrorPageProps) {
  const copy = errorCopyOf(status);
  const inBackoffice = useRouterState({
    select: (state) => state.location.pathname.startsWith("/backoffice"),
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const [retrying, setRetrying] = useState(false);
  const canRetry = onRetry !== undefined && copy.retryable;

  // The page replaced what was loading: move focus to what it says.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-6 py-8 text-center sm:py-12">
      <StatusDigits status={status} />
      <div className="flex flex-col items-center gap-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold tracking-tight text-balance outline-none"
        >
          <span className="sr-only">Erro {status}: </span>
          {title ?? copy.title}
        </h1>
        <p className="text-balance text-muted-foreground">{description ?? copy.description}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {canRetry ? (
          <Button size="lg" disabled={retrying} onClick={() => void retry()}>
            <RotateCwIcon
              aria-hidden
              data-icon="inline-start"
              className={cn(retrying && "animate-spin")}
            />
            Tentar de novo
          </Button>
        ) : null}
        {action ?? (
          <Link
            to={inBackoffice ? "/backoffice" : "/cadastro/paciente"}
            className={buttonVariants({ variant: canRetry ? "outline" : "default", size: "lg" })}
          >
            <HouseIcon aria-hidden data-icon="inline-start" />
            {inBackoffice ? "Voltar ao painel" : "Voltar ao início"}
          </Link>
        )}
      </div>
      {import.meta.env.DEV && details ? (
        <details className="w-full text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">Detalhes técnicos (só em desenvolvimento)</summary>
          <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 whitespace-pre-wrap">
            {details}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
