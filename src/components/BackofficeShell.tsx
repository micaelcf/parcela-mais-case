import { Link } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";

const NAV = [
  { to: "/backoffice", label: "Painel", exact: true },
  { to: "/backoffice/consultas", label: "Consultas", exact: false },
  { to: "/backoffice/financeiras", label: "Financeiras", exact: false },
  { to: "/backoffice/abuso", label: "Abuso e limites", exact: false },
] as const;

/** Backoffice frame: brand, section nav and the operator's logout (signed in), content, toasts. */
export function BackofficeShell({
  operator,
  loggingOut = false,
  onLogout,
  children,
}: {
  /** The signed-in username; null on the login page. */
  operator: string | null;
  loggingOut?: boolean;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Ir para o conteúdo
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <span className="font-heading text-lg font-semibold tracking-tight">
            Parcela <span className="text-primary">Mais</span>{" "}
            <span className="text-sm font-normal text-muted-foreground">Backoffice</span>
          </span>
          {operator ? (
            <>
              <nav aria-label="Seções do backoffice" className="flex flex-1 flex-wrap gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.exact, includeSearch: false }}
                    className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  Operador: <span className="font-medium text-foreground">{operator}</span>
                </span>
                <Button variant="outline" size="sm" disabled={loggingOut} onClick={onLogout}>
                  <LogOutIcon aria-hidden data-icon="inline-start" />
                  Sair
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </header>
      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none"
      >
        {children}
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
