import { cn } from "cn";

import { LENDER_NAME } from "#/components/modules/consultation/lender-copy";
import type { LenderCode } from "#/lib/enums";

import { LenderLogo, type LenderLogoSize } from "./LenderLogo";

const GAP_CLASS: Record<LenderLogoSize, string> = {
  sm: "gap-1.5",
  md: "gap-2",
  lg: "gap-2.5",
};

/** How a lender is shown everywhere: its logo, then its name (the accessible text). */
export function LenderIdentity({
  lender,
  size = "md",
  className,
}: {
  lender: LenderCode;
  size?: LenderLogoSize;
  className?: string;
}) {
  return (
    <span
      data-lender-identity={lender}
      className={cn("inline-flex items-center align-middle", GAP_CLASS[size], className)}
    >
      <LenderLogo lender={lender} size={size} />
      <span>{LENDER_NAME[lender]}</span>
    </span>
  );
}
