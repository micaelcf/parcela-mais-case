import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  FileSearchIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  type LucideIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { Button, buttonVariants } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";
import { useThemeMode } from "#/hooks/use-theme-mode";

type Section = {
  to: "/backoffice" | "/backoffice/consultas" | "/backoffice/financeiras" | "/backoffice/abuso";
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (the dashboard); the others also on their nested pages. */
  exact: boolean;
};

const SECTIONS: ReadonlyArray<Section> = [
  { to: "/backoffice", label: "Painel", icon: LayoutDashboardIcon, exact: true },
  { to: "/backoffice/consultas", label: "Consultas", icon: FileSearchIcon, exact: false },
  { to: "/backoffice/financeiras", label: "Financeiras", icon: LandmarkIcon, exact: false },
  { to: "/backoffice/abuso", label: "Abuso e limites", icon: ShieldAlertIcon, exact: false },
];

/** The section `pathname` belongs to, by the same rule the links mark themselves active with. */
function activeSectionIndex(pathname: string): number {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SECTIONS.findIndex((section) =>
    section.exact ? path === section.to : path === section.to || path.startsWith(`${section.to}/`),
  );
}

/** Backoffice frame: brand, operator and logout, the section bar (signed in), content, toasts. */
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
  const { mode } = useThemeMode();
  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
      >
        Ir para o conteúdo
      </a>
      {/* Pinned on wider screens; on a phone the wrapped header would eat too much of it. */}
      <div className="z-40 md:sticky md:top-0">
        <header className="border-b bg-background">
          <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <span className="font-heading text-lg font-semibold tracking-tight">
              Parcela <span className="text-primary">Mais</span>{" "}
              <span className="text-sm font-normal text-muted-foreground">Backoffice</span>
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {operator ? (
                <>
                  <span className="text-muted-foreground">
                    Operador: <span className="font-medium text-foreground">{operator}</span>
                  </span>
                  <Button variant="outline" size="sm" disabled={loggingOut} onClick={onLogout}>
                    <LogOutIcon aria-hidden data-icon="inline-start" />
                    Sair
                  </Button>
                </>
              ) : null}
              <Link
                to="/cadastro/paciente"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                Ir para o cadastro
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>
        {operator ? <SectionBar /> : null}
      </div>
      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none"
      >
        {children}
      </main>
      <Toaster position="top-center" richColors theme={mode} />
    </div>
  );
}

/**
 * The backoffice sections, one row under the header. A pill slides to the current section (none
 * under `prefers-reduced-motion`); on a narrow screen the row scrolls sideways and keeps the
 * current section in view.
 */
function SectionBar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const active = activeSectionIndex(pathname);
  const listRef = useRef<HTMLUListElement>(null);
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  // Where the pill sits; it slides from its second placement on (it never slides in on load).
  const [pill, setPill] = useState<{ left: number; width: number; slide: boolean } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const place = () => {
      const link = active === -1 ? null : linkRefs.current[active];
      if (!link) {
        setPill(null);
        return;
      }
      // Offsets in the list's scroll content: the list is the links' offset parent.
      const left = link.offsetLeft;
      const width = link.offsetWidth;
      setPill((previous) =>
        previous?.left === left && previous.width === width
          ? previous
          : { left, width, slide: previous !== null },
      );
      if (left < list.scrollLeft || left + width > list.scrollLeft + list.clientWidth) {
        list.scrollTo({ left: left - 16 });
      }
    };
    place();
    // The list for the viewport, the links for their text (a late web font changes their width).
    const observer = new ResizeObserver(place);
    observer.observe(list);
    for (const link of linkRefs.current) if (link) observer.observe(link);
    return () => observer.disconnect();
  }, [active]);

  return (
    <nav aria-label="Seções do backoffice" className="border-b bg-background/95 backdrop-blur">
      <ul
        ref={listRef}
        className="relative mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pill ? (
          <li
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-1.5 left-0 rounded-md bg-primary/10 ring-1 ring-primary/20 ring-inset",
              "after:absolute after:inset-x-3 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-primary",
              pill.slide &&
                "transition-[translate,width] duration-300 ease-out motion-reduce:transition-none",
            )}
            style={{ width: pill.width, translate: `${pill.left}px 0` }}
          />
        ) : null}
        {SECTIONS.map((section, index) => (
          <li key={section.to} className="shrink-0">
            <Link
              ref={(element) => {
                linkRefs.current[index] = element;
              }}
              to={section.to}
              activeOptions={{ exact: section.exact, includeSearch: false }}
              className="group relative flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[status=active]:text-primary data-[status=active]:hover:bg-transparent"
            >
              <section.icon
                aria-hidden
                className="size-4 transition-transform duration-200 ease-out group-hover:-translate-y-px group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none"
              />
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
