import { cn } from "cn";
import type { ReactNode } from "react";

import type { LenderCode } from "#/lib/enums";

export type LenderLogoSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<LenderLogoSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
};

/** Each fictional lender's tile colour: a theme token, lighter in dark mode. */
const TILE_CLASS: Record<LenderCode, string> = {
  ALFA: "text-lender-alfa",
  BETA: "text-lender-beta",
  GAMA: "text-lender-gama",
  DELTA: "text-lender-delta",
};

/** Each lender's glyph on a 24×24 grid, drawn in the page background over its tile. */
const GLYPH: Record<LenderCode, ReactNode> = {
  // A rising chevron.
  ALFA: <path className="fill-background" d="M12 6.25 19 17.25h-3.6L12 11.6l-3.4 5.65H5Z" />,
  // Two stacked half-discs.
  BETA: (
    <path
      className="fill-background"
      d="M7.75 5.5h4.5a3.25 3.25 0 0 1 0 6.5h-4.5Zm0 7h5.5a3.25 3.25 0 0 1 0 6.5h-5.5Z"
    />
  ),
  // A gamma's corner holding a coin.
  GAMA: (
    <>
      <path
        className="stroke-background"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        d="M7.5 18V7H17"
      />
      <circle className="fill-background" cx="15" cy="15" r="2.75" />
    </>
  ),
  // A hollow delta.
  DELTA: (
    <path
      className="fill-background"
      fillRule="evenodd"
      d="M12 5 19.75 18.5H4.25ZM12 10.4l-3.15 5.35h6.3Z"
    />
  ),
};

/**
 * A fictional lender's mark: a rounded tile in its brand colour with a geometric glyph.
 * Decorative only; the lender's name next to it is the accessible text.
 */
export function LenderLogo({
  lender,
  size = "md",
  className,
}: {
  lender: LenderCode;
  size?: LenderLogoSize;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      data-lender-logo={lender}
      className={cn("shrink-0", SIZE_CLASS[size], TILE_CLASS[lender], className)}
    >
      <rect width="24" height="24" rx="6" fill="currentColor" />
      {GLYPH[lender]}
    </svg>
  );
}
