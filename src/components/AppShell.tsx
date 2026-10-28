import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { LockKeyholeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";

/** Public frame: brand header, centred content column, footer, toasts. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Ir para o conteúdo
      </a>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            to="/cadastro/paciente"
            className="rounded-md font-heading text-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Parcela <span className="text-primary">Mais</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Pré-aprovação para tratamentos
            </span>
            {/* The backoffice redirects to its login when there's no session. */}
            <Link
              to="/backoffice"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <LockKeyholeIcon aria-hidden data-icon="inline-start" />
              Área da clínica
            </Link>
          </div>
        </div>
      </header>
      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none"
      >
        {children}
      </main>
      <footer className="border-t">
        <p className="mx-auto max-w-5xl px-4 py-4 text-xs text-muted-foreground">
          Simulação de crédito com financeiras parceiras. Nenhuma oferta é um contrato.
        </p>
      </footer>
      <Toaster position="top-center" richColors />
    </div>
  );
}
