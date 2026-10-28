import { CalendarIcon } from "lucide-react";
import { type FocusEvent, type Ref, useRef, useState } from "react";
import { ptBR } from "react-day-picker/locale";

import { Calendar } from "#/components/ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import {
  dateFromIso,
  dateTextFromIso,
  isoFromDate,
  isoFromDateText,
  maskDateText,
} from "#/lib/date/date-text";

type DatePickerProps = {
  id?: string;
  name?: string;
  ref?: Ref<HTMLInputElement>;
  /** ISO `YYYY-MM-DD`, or empty while no complete real date is typed or picked. */
  value: string;
  onValueChange: (iso: string) => void;
  /** Focus left the picker: its input, its button and its open calendar. */
  onBlur?: () => void;
  placeholder?: string;
  autoComplete?: string;
  /** The month the calendar opens on while no date is set. */
  defaultMonth?: Date;
  /** First and last months the calendar navigates to. */
  startMonth?: Date;
  endMonth?: Date;
  captionLayout?: "label" | "dropdown";
  disabled?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

/**
 * A date typed as `dd/mm/aaaa` or picked from a calendar: shadcn's date picker with an input. The
 * value is ISO `YYYY-MM-DD`; an incomplete or impossible typed date reads as empty while its text
 * stays.
 */
export function DatePicker({
  id,
  name,
  ref,
  value,
  onValueChange,
  onBlur,
  placeholder = "dd/mm/aaaa",
  autoComplete = "off",
  defaultMonth,
  startMonth,
  endMonth,
  captionLayout,
  disabled,
  invalid,
  "aria-describedby": describedBy,
  className,
}: DatePickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => dateTextFromIso(value));
  const [month, setMonth] = useState(() => dateFromIso(value) ?? defaultMonth);
  // A value set from outside (a reset, a pick, a URL change) replaces the text; one that matches
  // what's typed doesn't, so a half-typed date survives until it's complete.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if ((isoFromDateText(text) ?? "") !== value) setText(dateTextFromIso(value));
    const date = dateFromIso(value);
    if (date) setMonth(date);
  }
  // What the input shows, so the calendar agrees with it before the owner's value catches up.
  const selected = dateFromIso(isoFromDateText(text) ?? "");

  function commit(iso: string) {
    const date = dateFromIso(iso);
    if (date) setMonth(date);
    if (iso !== value) onValueChange(iso);
  }

  // The calendar is portalled, but its focus events bubble here through the React tree.
  function leave(event: FocusEvent) {
    const next = event.relatedTarget;
    const inside =
      next instanceof Node &&
      (groupRef.current?.contains(next) || popupRef.current?.contains(next));
    if (!inside) onBlur?.();
  }

  return (
    <InputGroup ref={groupRef} onBlur={leave} className={className}>
      <InputGroupInput
        ref={ref}
        id={id}
        name={name}
        value={text}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="tabular-nums"
        onChange={(event) => {
          const masked = maskDateText(event.target.value);
          setText(masked);
          commit(isoFromDateText(masked) ?? "");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={disabled}
            render={
              <InputGroupButton variant="ghost" size="icon-xs" aria-label="Selecionar data" />
            }
          >
            <CalendarIcon />
          </PopoverTrigger>
          {/* The calendar's `autoFocus` moves focus to the selected day (or today) instead. */}
          <PopoverContent
            ref={popupRef}
            initialFocus={false}
            className="w-auto overflow-hidden p-0"
            align="end"
            alignOffset={-8}
            sideOffset={10}
          >
            <Calendar
              mode="single"
              autoFocus
              locale={ptBR}
              selected={selected}
              month={month}
              onMonthChange={setMonth}
              startMonth={startMonth}
              endMonth={endMonth}
              captionLayout={captionLayout}
              onSelect={(date) => {
                const iso = date ? isoFromDate(date) : "";
                setText(dateTextFromIso(iso));
                commit(iso);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}
