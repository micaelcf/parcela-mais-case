import { CalendarIcon } from "lucide-react";
import { type Ref, useEffect, useRef, useState } from "react";
import {
  type DayButtonProps,
  type DropdownOption,
  type DropdownProps,
  useDayPicker,
} from "react-day-picker";
import { ptBR } from "react-day-picker/locale";

import { Button } from "#/components/ui/button";
import { Calendar, CalendarDayButton } from "#/components/ui/calendar";
import { Input } from "#/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { cn } from "#/lib/utils";

import {
  dateFromIso,
  dateTextFromIso,
  isoFromDate,
  isoFromDateText,
  maskDateText,
} from "./date-text";

/** One of the calendar caption's month/year pickers, as a design-system select. */
function CaptionSelect({
  options = [],
  value,
  label,
  onPick,
}: {
  options?: DropdownOption[];
  value: DropdownProps["value"];
  label: string | undefined;
  onPick: (value: number) => void;
}) {
  const items = options.map((option) => ({ value: option.value, label: option.label }));
  return (
    <Select
      items={items}
      value={typeof value === "number" ? value : null}
      onValueChange={(next: number | null) => {
        if (next !== null) onPick(next);
      }}
    >
      {/* Positioned, so it paints over the calendar's full-width nav bar laid out before it. */}
      <SelectTrigger aria-label={label} size="sm" className="relative min-w-0 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-64 min-w-24">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="capitalize"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MonthsDropdown({ options, value, "aria-label": label }: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  const shown = months[0].date;
  return (
    <CaptionSelect
      options={options}
      value={value}
      label={label}
      onPick={(month) => goToMonth(new Date(shown.getFullYear(), month, 1))}
    />
  );
}

function YearsDropdown({ options, value, "aria-label": label }: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  const shown = months[0].date;
  return (
    <CaptionSelect
      options={options}
      value={value}
      label={label}
      onPick={(year) => goToMonth(new Date(year, shown.getMonth(), 1))}
    />
  );
}

/**
 * The calendar's day button, wired to take focus when the grid's arrow keys move to it (the
 * vendored `CalendarDayButton` tracks the focused day but never attaches its ref, nor takes one).
 */
function DayButton(props: DayButtonProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const { focused } = props.modifiers;
  useEffect(() => {
    if (focused) ref.current?.querySelector("button")?.focus();
  }, [focused]);
  return (
    <span ref={ref} className="contents">
      <CalendarDayButton {...props} locale={ptBR} />
    </span>
  );
}

const CALENDAR_COMPONENTS = { MonthsDropdown, YearsDropdown, DayButton };

type DatePickerProps = {
  id: string;
  name?: string;
  /** ISO `YYYY-MM-DD`, or empty while no complete real date is typed or picked. */
  value: string;
  onValueChange: (iso: string) => void;
  onBlur?: () => void;
  /** First and last months the calendar's month/year dropdowns offer. */
  startMonth: Date;
  endMonth: Date;
  /** The month the calendar opens on while no date is set. */
  defaultMonth?: Date;
  /** Accessible name of the button that opens the calendar. */
  calendarLabel: string;
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  /** Classes of the wrapper (width) and of the text input (height). */
  className?: string;
  inputClassName?: string;
};

/**
 * A date typed as `dd/mm/aaaa` or picked from a calendar (month and year dropdowns). The value is
 * ISO `YYYY-MM-DD`; an incomplete or impossible typed date reads as empty while its text stays.
 */
export function DatePicker({
  id,
  name,
  value,
  onValueChange,
  onBlur,
  startMonth,
  endMonth,
  defaultMonth,
  calendarLabel,
  autoComplete = "off",
  inputRef,
  invalid,
  describedBy,
  className,
  inputClassName,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => dateTextFromIso(value));
  // A value set from outside (a reset, a pick, a URL change) replaces the text; one that matches
  // what's typed doesn't, so a half-typed date survives until it's complete.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if ((isoFromDateText(text) ?? "") !== value) setText(dateTextFromIso(value));
  }
  const selected = dateFromIso(value);

  function commit(iso: string) {
    if (iso !== value) onValueChange(iso);
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        inputMode="numeric"
        autoComplete={autoComplete}
        placeholder="dd/mm/aaaa"
        value={text}
        onChange={(event) => {
          const masked = maskDateText(event.target.value);
          setText(masked);
          commit(isoFromDateText(masked) ?? "");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("h-10 pr-11 tabular-nums", inputClassName)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={calendarLabel}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            />
          }
        >
          <CalendarIcon aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="end" sideOffset={8}>
          <Calendar
            mode="single"
            required
            captionLayout="dropdown"
            locale={ptBR}
            selected={selected}
            defaultMonth={selected ?? defaultMonth}
            startMonth={startMonth}
            endMonth={endMonth}
            components={CALENDAR_COMPONENTS}
            onSelect={(date) => {
              const iso = isoFromDate(date);
              setText(dateTextFromIso(iso));
              commit(iso);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
