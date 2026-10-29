import { cn } from "cn";
import { type PointerEvent, useEffect, useState } from "react";

type Tone = "client" | "server" | "fixed";

const TONE_TEXT: Record<Tone, string> = {
  client: "from-primary to-primary/30",
  server: "from-destructive to-destructive/30",
  fixed: "from-success to-success/30",
};

const TONE_GLOW: Record<Tone, string> = {
  client: "bg-primary/20",
  server: "bg-destructive/20",
  fixed: "bg-success/30",
};

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** A beat after the first paint, so the reels visibly spin up from 000. */
const SPIN_UP_DELAY_MS = 120;

function digitsOf(status: number): number[] {
  return String(status).padStart(3, "0").slice(-3).split("").map(Number);
}

function setTilt(element: HTMLElement, x: number, y: number) {
  element.style.setProperty("--tilt-x", x.toFixed(3));
  element.style.setProperty("--tilt-y", y.toFixed(3));
}

/**
 * The status as three odometer reels, a toy beside the message: they spin up from 000, lean
 * toward the pointer under a glow that follows it, and each click rolls one digit on. Rolled to
 * 200, they turn green. Decorative: hidden from assistive technology (the heading carries the
 * status) and out of the tab order; still under `prefers-reduced-motion`.
 */
export function StatusDigits({ status }: { status: number }) {
  const [digits, setDigits] = useState(() => digitsOf(status).map(() => 0));
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDigits(digitsOf(status)), SPIN_UP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const tone: Tone = digits.join("") === "200" ? "fixed" : status >= 500 ? "server" : "client";

  function roll(index: number) {
    setPlayed(true);
    setDigits((current) => current.map((digit, i) => (i === index ? (digit + 1) % 10 : digit)));
  }

  function lean(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setTilt(
      event.currentTarget,
      (event.clientX - box.left) / box.width - 0.5,
      (event.clientY - box.top) / box.height - 0.5,
    );
  }

  return (
    <div aria-hidden className="flex flex-col items-center gap-2 select-none">
      <div
        onPointerMove={lean}
        onPointerLeave={(event) => setTilt(event.currentTarget, 0, 0)}
        className="relative isolate flex px-6 py-2 [--tilt-x:0] [--tilt-y:0] perspective-[900px]"
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-x-10 inset-y-6 -z-10 rounded-full blur-3xl transition-colors duration-500",
            "translate-x-[calc(var(--tilt-x)*60px)] translate-y-[calc(var(--tilt-y)*40px)] motion-reduce:translate-none",
            TONE_GLOW[tone],
          )}
        />
        {digits.map((digit, index) => (
          <button
            // The reels never reorder: the position is the identity.
            key={index}
            type="button"
            tabIndex={-1}
            onClick={() => roll(index)}
            className={cn(
              "relative h-[1em] cursor-pointer overflow-hidden rounded-2xl px-[0.04em] font-heading text-[clamp(5rem,22vw,9.5rem)] leading-none font-semibold tabular-nums",
              "transition-[translate,scale,transform] duration-300 ease-out hover:-translate-y-1.5 active:scale-95",
              "transform-[rotateX(calc(var(--tilt-y)*-20deg))_rotateY(calc(var(--tilt-x)*24deg))] motion-reduce:transform-none",
            )}
          >
            <span
              className="flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
              style={{
                transform: `translateY(-${digit * 10}%)`,
                // Staggered while spinning up; a click rolls at once.
                transitionDelay: played ? "0ms" : `${index * 110}ms`,
              }}
            >
              {FACES.map((face) => (
                <span
                  key={face}
                  className={cn(
                    "block h-[1em] bg-linear-to-b bg-clip-text text-transparent",
                    TONE_TEXT[tone],
                  )}
                >
                  {face}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
      <p className="h-4 text-xs text-muted-foreground">
        {tone === "fixed" ? "200 OK… se consertar fosse simples assim." : "Mexa nos números."}
      </p>
    </div>
  );
}
