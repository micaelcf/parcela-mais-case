import { Button } from "#/components/ui/button";

import { PERIOD, type Period, PERIODS } from "./metrics-period";

/** The dashboards' time window: one pressed button per period. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div role="group" aria-label="Período" className="flex flex-wrap gap-1">
      {PERIODS.map((period) => (
        <Button
          key={period}
          size="sm"
          variant={period === value ? "default" : "outline"}
          aria-pressed={period === value}
          onClick={() => onChange(period)}
        >
          {PERIOD[period].label}
        </Button>
      ))}
    </div>
  );
}
