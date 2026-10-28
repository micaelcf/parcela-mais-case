import { Check, type LucideIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "cn";

/**
 * Motion ported from React Bits' Stepper (Web Animations API, no library): a spring `linear()`
 * easing with a cubic-bezier fallback, a glider tile that springs under the active step, a check
 * that draws itself in, and a content pane that slides 36 px in the direction of travel while
 * fading in and its viewport animates to the new height. `prefers-reduced-motion` drops the
 * spring and the slide.
 */
const SPRING =
  "linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)";
const SPRING_FALLBACK = "cubic-bezier(0.34, 1.4, 0.64, 1)";
const SETTLE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING_MS = 560;
const SLIDE_PX = 36;

function springEasing(): string {
  return typeof CSS !== "undefined" && CSS.supports("transition-timing-function", "linear(0, 1)")
    ? SPRING
    : SPRING_FALLBACK;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type StepperStep = {
  title: string;
  icon: LucideIcon;
};

type StepStatus = "complete" | "active" | "upcoming";

/** A check whose stroke draws in when it mounts (a step just completed). */
function DrawnCheck() {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const path = ref.current?.querySelector("path");
    if (!path || typeof path.animate !== "function" || reducedMotion()) return;
    path.style.strokeDasharray = "24";
    path.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], {
      duration: 360,
      easing: SETTLE,
    });
  }, []);
  return <Check ref={ref} aria-hidden strokeWidth={2.75} className="size-4" />;
}

const TILE_CLASS: Record<StepStatus, string> = {
  complete: "bg-primary/12 text-primary dark:bg-primary/20",
  active: "bg-primary text-primary-foreground shadow-sm",
  upcoming: "text-muted-foreground ring-1 ring-border ring-inset dark:ring-input",
};

const TITLE_CLASS: Record<StepStatus, string> = {
  complete: "font-medium text-foreground",
  active: "font-semibold text-foreground",
  upcoming: "text-muted-foreground",
};

type StepperProps = {
  steps: readonly StepperStep[];
  /** Index of the active step. */
  current: number;
  /** Accessible name of the step list's `<nav>`. */
  label: string;
  /** A visible line above the steps (e.g. "Step 2 of 3"). */
  caption?: ReactNode;
  /** Screen-reader suffix of a completed step's name (e.g. "completed"). */
  completedLabel?: string;
  /** A completed step was picked: completed steps are buttons, the others aren't interactive. */
  onStepSelect?: (index: number) => void;
  className?: string;
};

/**
 * A horizontal step list: each step's icon and title, completed steps checked (and clickable when
 * `onStepSelect` is given), the active one on a springing glider with `aria-current="step"`.
 */
export function Stepper({
  steps,
  current,
  label,
  caption,
  completedLabel,
  onStepSelect,
  className,
}: StepperProps) {
  const trackRef = useRef<HTMLOListElement>(null);
  const gliderRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const glider = gliderRef.current;
    if (!track || !glider) return;
    const place = (animate: boolean) => {
      const segment = track.querySelector<HTMLElement>(`[data-step-index="${current}"]`);
      if (!segment) {
        glider.style.opacity = "0";
        return;
      }
      const easing = springEasing();
      glider.style.transition = animate
        ? `transform ${SPRING_MS}ms ${easing}, width ${SPRING_MS}ms ${easing}, height ${SPRING_MS}ms ${easing}, opacity 200ms ease`
        : "opacity 200ms ease";
      glider.style.transform = `translate3d(${segment.offsetLeft}px, ${segment.offsetTop}px, 0)`;
      glider.style.width = `${segment.offsetWidth}px`;
      glider.style.height = `${segment.offsetHeight}px`;
      glider.style.opacity = "1";
    };
    place(placedRef.current && !reducedMotion());
    placedRef.current = true;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(track);
    return () => observer.disconnect();
  }, [current, steps.length]);

  return (
    <nav aria-label={label} className={cn("flex flex-col gap-2", className)}>
      {caption ? <p className="text-sm text-muted-foreground">{caption}</p> : null}
      <ol
        ref={trackRef}
        className="relative grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1"
      >
        <span
          ref={gliderRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-lg bg-background opacity-0 shadow-sm ring-1 ring-foreground/10 dark:bg-accent"
        />
        {steps.map((step, index) => {
          const status: StepStatus =
            index < current ? "complete" : index === current ? "active" : "upcoming";
          const Icon = step.icon;
          const body = (
            <>
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
                  TILE_CLASS[status],
                )}
              >
                {status === "complete" ? (
                  <DrawnCheck />
                ) : (
                  <Icon
                    aria-hidden
                    strokeWidth={status === "active" ? 2.25 : 2}
                    className="size-4"
                  />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-sm transition-colors duration-200",
                  TITLE_CLASS[status],
                )}
              >
                {step.title}
                {status === "complete" && completedLabel ? (
                  <span className="sr-only">{` (${completedLabel})`}</span>
                ) : null}
              </span>
            </>
          );
          const segmentClass =
            "relative flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg px-2 py-2 sm:flex-row sm:gap-2.5 sm:px-3";
          return (
            <li
              key={step.title}
              data-step-index={index}
              data-status={status}
              aria-current={status === "active" ? "step" : undefined}
              className="relative flex min-w-0"
            >
              {status === "complete" && onStepSelect ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  className={cn(
                    segmentClass,
                    "cursor-pointer outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
                  )}
                >
                  {body}
                </button>
              ) : (
                <span className={segmentClass}>{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type StepperContentProps = {
  /** Index of the step shown: a change animates the content in from the side it comes from. */
  step: number;
  children: ReactNode;
  className?: string;
};

/**
 * The step's content: when `step` changes, the new content slides in from the direction of travel
 * and fades in while the viewport animates from the old height to the new one. The content is
 * never remounted, so focus stays where the step puts it.
 */
export function StepperContent({ step, children, className }: StepperContentProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const [view, setView] = useState({ step, direction: 1, changes: 0 });
  if (view.step !== step) {
    setView({ step, direction: step > view.step ? 1 : -1, changes: view.changes + 1 });
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    heightRef.current = viewport.offsetHeight;
    const observer = new ResizeObserver(() => {
      heightRef.current = viewport.offsetHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const pane = paneRef.current;
    if (view.changes === 0 || !viewport || !pane || typeof viewport.animate !== "function") return;
    for (const element of [viewport, pane]) {
      for (const animation of element.getAnimations()) animation.cancel();
    }
    const reduced = reducedMotion();
    const easing = springEasing();
    const from = heightRef.current;
    const to = viewport.offsetHeight;
    if (Math.abs(from - to) > 0.5) {
      viewport.style.overflow = "hidden";
      const resize = viewport.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: reduced ? 200 : SPRING_MS,
        easing: reduced ? SETTLE : easing,
      });
      resize.onfinish = resize.oncancel = () => {
        viewport.style.overflow = "";
      };
    }
    if (!reduced) {
      pane.animate(
        [{ transform: `translateX(${view.direction * SLIDE_PX}px)` }, { transform: "none" }],
        { duration: SPRING_MS, easing },
      );
    }
    pane.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], {
      duration: reduced ? 200 : 420,
      easing: "ease-out",
    });
  }, [view.changes, view.direction]);

  return (
    <div ref={viewportRef} className={className}>
      <div ref={paneRef}>{children}</div>
    </div>
  );
}
