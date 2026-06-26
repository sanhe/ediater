import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BUILTIN_THEMES,
  BUILTIN_THEMES_BY_ID,
  combineThemes,
  DEFAULT_DARK_THEME_ID,
  resolveTheme,
  THEME_COLOR_FIELDS,
  type Theme,
  type ThemePreference,
} from "./themes";

interface ThemeContextValue {
  /** The concrete theme currently applied (after resolving "system"). */
  resolved: Theme;
  /** Built-in themes plus the user's custom themes, in picker order. */
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  resolved: BUILTIN_THEMES_BY_ID[DEFAULT_DARK_THEME_ID],
  themes: BUILTIN_THEMES,
});

/**
 * The concrete theme currently applied. Consumers that need the *appearance* —
 * chiefly the editor, for its syntax palette — read this rather than the raw
 * preference.
 */
export function useResolvedTheme(): Theme {
  return useContext(ThemeContext).resolved;
}

/** Every selectable theme (built-in + custom), for pickers and commands. */
export function useAllThemes(): Theme[] {
  return useContext(ThemeContext).themes;
}

/**
 * Write a theme's palette onto the document root as inline CSS custom
 * properties, plus `data-theme`/`color-scheme` for selectors and native widgets.
 * Driving everything from data (rather than per-theme CSS blocks) is what makes
 * user-authored and imported themes work without a rebuild.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const field of THEME_COLOR_FIELDS) {
    root.style.setProperty(field.cssVar, theme.colors[field.key]);
  }
  root.dataset.theme = theme.id;
  root.dataset.themeKind = theme.kind;
  root.style.colorScheme = theme.kind;
}

/** Track the OS colour scheme so the "system" preference can follow it live. */
function useSystemPrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [prefersDark, setPrefersDark] = useState<boolean>(
    () => window.matchMedia?.(query).matches ?? false,
  );

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return prefersDark;
}

interface ThemeControllerProps {
  preference: ThemePreference;
  customThemes: Theme[];
  children: ReactNode;
}

/**
 * Resolves the persisted theme preference (honouring "system" and custom
 * themes), applies it to the DOM, and publishes the resolved theme + full theme
 * list to descendants via context.
 */
export function ThemeController({
  preference,
  customThemes,
  children,
}: ThemeControllerProps) {
  const systemPrefersDark = useSystemPrefersDark();
  const themes = useMemo(() => combineThemes(customThemes), [customThemes]);
  const resolved = useMemo(
    () => resolveTheme(preference, systemPrefersDark, themes),
    [preference, systemPrefersDark, themes],
  );

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({ resolved, themes }),
    [resolved, themes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
