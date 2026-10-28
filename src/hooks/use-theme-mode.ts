import { useCallback, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark";

/** The key the pre-paint script in `routes/__root.tsx` reads; absent → follow the system. */
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The class on `<html>` is the source of truth (the pre-paint script set it before React ran). */
function appliedMode(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.style.colorScheme = mode;
}

function storedMode(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // Without an explicit choice, the page keeps following the system setting as it changes.
  const media = window.matchMedia(DARK_QUERY);
  const followSystem = () => {
    if (!storedMode()) apply(media.matches ? "dark" : "light");
  };
  media.addEventListener("change", followSystem);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", followSystem);
  };
}

/** The applied light/dark theme and a setter that remembers the choice in this browser. */
export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, appliedMode, () => "light" as const);
  const setMode = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage refused (private mode, quota): the choice still applies until the next load.
    }
    apply(next);
  }, []);
  return { mode, setMode };
}
