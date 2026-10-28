import { type LucideIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { type ThemeMode, useThemeMode } from "#/hooks/use-theme-mode";

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "light" };
/** The icon shows what a press switches to. */
const ICON: Record<ThemeMode, LucideIcon> = { light: MoonIcon, dark: SunIcon };
const HINT: Record<ThemeMode, string> = {
  light: "Mudar para o tema escuro",
  dark: "Mudar para o tema claro",
};

/** Light/dark switch for the top bars: a toggle button pressed while the dark theme is on. */
export function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  const Icon = ICON[mode];
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Tema escuro"
      aria-pressed={mode === "dark"}
      title={HINT[mode]}
      onClick={() => setMode(NEXT[mode])}
    >
      <Icon aria-hidden />
    </Button>
  );
}
