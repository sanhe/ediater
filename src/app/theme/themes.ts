/**
 * Theme registry. Themes are fully *data-driven*: each carries its colour
 * palette as plain data, which {@link applyTheme} (in ThemeContext) writes onto
 * the document as inline CSS custom properties. That is what lets users author,
 * import, and share themes at runtime — a theme is just JSON, whether it ships
 * with the app, lives in the user's session, or arrives from a `.json` file or
 * a remote theme pack.
 *
 * Pure data + functions (no React, no DOM) so it can be unit-tested directly and
 * imported from anywhere (session, reducer, editor, command registry).
 */

export type ThemeKind = "light" | "dark";

/** The full set of themeable colours. Keys map to CSS vars via the table below. */
export interface ThemeColors {
  bg: string;
  bgElevated: string;
  bgPanel: string;
  border: string;
  fg: string;
  fgMuted: string;
  accent: string;
  accentSoft: string;
  accentFg: string;
  titlebarBg: string;
  statusbarBg: string;
  statusbarFg: string;
  editorBg: string;
  editorFg: string;
  editorGutterFg: string;
  editorActiveLine: string;
  editorSelection: string;
  editorCursor: string;
}

export interface Theme {
  /** Stable id; also the value written to the document's `data-theme`. */
  id: string;
  /** Human-readable label shown in the theme picker. */
  label: string;
  /** Base appearance — drives the editor syntax palette and native color-scheme. */
  kind: ThemeKind;
  /** The palette applied as CSS custom properties. */
  colors: ThemeColors;
  /** True for the bundled themes; user/imported themes leave it unset. */
  builtin?: boolean;
}

export interface ThemeColorField {
  key: keyof ThemeColors;
  /** CSS custom property this colour drives. */
  cssVar: string;
  label: string;
  group: "Surfaces" | "Text" | "Accent" | "Editor";
}

/**
 * The colour fields, in editor display order. This single table is the source of
 * truth for both *applying* a theme (key → cssVar) and *editing* one (labels and
 * grouping in the theme editor).
 */
export const THEME_COLOR_FIELDS: ThemeColorField[] = [
  { key: "bg", cssVar: "--bg", label: "Background", group: "Surfaces" },
  { key: "bgElevated", cssVar: "--bg-elevated", label: "Elevated surface", group: "Surfaces" },
  { key: "bgPanel", cssVar: "--bg-panel", label: "Panel", group: "Surfaces" },
  { key: "border", cssVar: "--border", label: "Border", group: "Surfaces" },
  { key: "titlebarBg", cssVar: "--titlebar-bg", label: "Title bar", group: "Surfaces" },
  { key: "statusbarBg", cssVar: "--statusbar-bg", label: "Status bar", group: "Surfaces" },
  { key: "fg", cssVar: "--fg", label: "Foreground", group: "Text" },
  { key: "fgMuted", cssVar: "--fg-muted", label: "Muted text", group: "Text" },
  { key: "statusbarFg", cssVar: "--statusbar-fg", label: "Status bar text", group: "Text" },
  { key: "accent", cssVar: "--accent", label: "Accent", group: "Accent" },
  { key: "accentSoft", cssVar: "--accent-soft", label: "Accent (soft)", group: "Accent" },
  { key: "accentFg", cssVar: "--accent-fg", label: "Accent text", group: "Accent" },
  { key: "editorBg", cssVar: "--editor-bg", label: "Editor background", group: "Editor" },
  { key: "editorFg", cssVar: "--editor-fg", label: "Editor text", group: "Editor" },
  { key: "editorGutterFg", cssVar: "--editor-gutter-fg", label: "Gutter", group: "Editor" },
  { key: "editorActiveLine", cssVar: "--editor-active-line", label: "Active line", group: "Editor" },
  { key: "editorSelection", cssVar: "--editor-selection", label: "Selection", group: "Editor" },
  { key: "editorCursor", cssVar: "--editor-cursor", label: "Cursor", group: "Editor" },
];

const THEME_COLOR_KEYS = THEME_COLOR_FIELDS.map((f) => f.key);

/**
 * The bundled themes. Adding one here is now a *single* change — no CSS edit
 * required, since the palette is applied from this data at runtime.
 */
export const BUILTIN_THEMES: Theme[] = [
  {
    id: "dark",
    label: "ediater Dark",
    kind: "dark",
    builtin: true,
    colors: {
      bg: "#1e1e1e",
      bgElevated: "#252526",
      bgPanel: "#1e1e1e",
      border: "#333333",
      fg: "#d4d4d4",
      fgMuted: "#858585",
      accent: "#2f7dd1",
      accentSoft: "rgba(47, 125, 209, 0.18)",
      accentFg: "#ffffff",
      titlebarBg: "#323233",
      statusbarBg: "#2f7dd1",
      statusbarFg: "#ffffff",
      editorBg: "#1e1e1e",
      editorFg: "#d4d4d4",
      editorGutterFg: "#6e7681",
      editorActiveLine: "rgba(255, 255, 255, 0.04)",
      editorSelection: "rgba(47, 125, 209, 0.3)",
      editorCursor: "#d4d4d4",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    kind: "dark",
    builtin: true,
    colors: {
      bg: "#0d1117",
      bgElevated: "#161b22",
      bgPanel: "#0d1117",
      border: "#21262d",
      fg: "#c9d1d9",
      fgMuted: "#8b949e",
      accent: "#58a6ff",
      accentSoft: "rgba(88, 166, 255, 0.15)",
      accentFg: "#ffffff",
      titlebarBg: "#161b22",
      statusbarBg: "#1f6feb",
      statusbarFg: "#ffffff",
      editorBg: "#0d1117",
      editorFg: "#c9d1d9",
      editorGutterFg: "#6e7681",
      editorActiveLine: "rgba(255, 255, 255, 0.04)",
      editorSelection: "rgba(56, 139, 253, 0.3)",
      editorCursor: "#c9d1d9",
    },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    kind: "dark",
    builtin: true,
    colors: {
      bg: "#000000",
      bgElevated: "#0a0a0a",
      bgPanel: "#000000",
      border: "#6fc3df",
      fg: "#ffffff",
      fgMuted: "#c4c4c4",
      accent: "#1aebff",
      accentSoft: "rgba(26, 235, 255, 0.2)",
      accentFg: "#000000",
      titlebarBg: "#000000",
      statusbarBg: "#000000",
      statusbarFg: "#ffffff",
      editorBg: "#000000",
      editorFg: "#ffffff",
      editorGutterFg: "#d4d4d4",
      editorActiveLine: "rgba(255, 255, 255, 0.08)",
      editorSelection: "rgba(255, 255, 255, 0.3)",
      editorCursor: "#ffffff",
    },
  },
  {
    id: "light",
    label: "ediater Light",
    kind: "light",
    builtin: true,
    colors: {
      bg: "#ffffff",
      bgElevated: "#f3f3f3",
      bgPanel: "#ffffff",
      border: "#e0e0e0",
      fg: "#1f1f1f",
      fgMuted: "#6e6e6e",
      accent: "#2f7dd1",
      accentSoft: "rgba(47, 125, 209, 0.14)",
      accentFg: "#ffffff",
      titlebarBg: "#dddddd",
      statusbarBg: "#2f7dd1",
      statusbarFg: "#ffffff",
      editorBg: "#ffffff",
      editorFg: "#1f1f1f",
      editorGutterFg: "#9aa0a6",
      editorActiveLine: "rgba(0, 0, 0, 0.04)",
      editorSelection: "rgba(47, 125, 209, 0.2)",
      editorCursor: "#1f1f1f",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    kind: "light",
    builtin: true,
    colors: {
      bg: "#fdf6e3",
      bgElevated: "#eee8d5",
      bgPanel: "#fdf6e3",
      border: "#ddd6c1",
      fg: "#586e75",
      fgMuted: "#93a1a1",
      accent: "#268bd2",
      accentSoft: "rgba(38, 139, 210, 0.15)",
      accentFg: "#fdf6e3",
      titlebarBg: "#eee8d5",
      statusbarBg: "#268bd2",
      statusbarFg: "#fdf6e3",
      editorBg: "#fdf6e3",
      editorFg: "#586e75",
      editorGutterFg: "#93a1a1",
      editorActiveLine: "rgba(0, 0, 0, 0.04)",
      editorSelection: "rgba(38, 139, 210, 0.18)",
      editorCursor: "#586e75",
    },
  },
];

export const BUILTIN_THEMES_BY_ID: Record<string, Theme> = indexThemes(BUILTIN_THEMES);

/** Theme used when "system" resolves to dark (and the ultimate fallback). */
export const DEFAULT_DARK_THEME_ID = "dark";
/** Theme used when "system" resolves to light. */
export const DEFAULT_LIGHT_THEME_ID = "light";

/** Special preference value: follow the operating-system colour scheme. */
export const SYSTEM_THEME = "system";

/** A persisted theme choice: a concrete theme id, or {@link SYSTEM_THEME}. */
export type ThemePreference = string;

export function indexThemes(themes: Theme[]): Record<string, Theme> {
  const byId: Record<string, Theme> = {};
  for (const theme of themes) byId[theme.id] = theme;
  return byId;
}

/**
 * Built-ins plus the user's custom themes, in picker order. A custom theme can
 * never shadow a built-in id (those are reserved at creation), so built-ins win.
 */
export function combineThemes(custom: Theme[]): Theme[] {
  const reserved = new Set(BUILTIN_THEMES.map((t) => t.id));
  return [...BUILTIN_THEMES, ...custom.filter((t) => !reserved.has(t.id))];
}

/**
 * Resolve a preference (possibly "system" or an unknown/removed id) to a
 * concrete theme from `themes`. Unknown ids fall back to the default dark theme
 * so a corrupt or stale persisted value never leaves the app unstyled.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
  themes: Theme[] = BUILTIN_THEMES,
): Theme {
  const byId = indexThemes(themes);
  const fallback = byId[DEFAULT_DARK_THEME_ID] ?? BUILTIN_THEMES[0];
  if (preference === SYSTEM_THEME) {
    const id = systemPrefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
    return byId[id] ?? fallback;
  }
  return byId[preference] ?? fallback;
}

// --- authoring / import / persistence -------------------------------------

const RESERVED_IDS = new Set<string>([
  ...BUILTIN_THEMES.map((t) => t.id),
  SYSTEM_THEME,
]);

export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "theme"
  );
}

/** A fresh id derived from `base`, unique against built-ins, system, and `taken`. */
function uniqueThemeId(base: string, taken: Iterable<string>): string {
  const used = new Set<string>([...RESERVED_IDS, ...taken]);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function isColorValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 80;
}

/**
 * Coerce untrusted JSON into a valid Theme, or null if it can't be salvaged.
 * Missing colours inherit from the default theme of the same kind, so partial
 * or hand-written themes still import cleanly. A unique id is assigned (derived
 * from `id` if present, else the label), avoiding collisions with `takenIds`.
 */
export function sanitizeTheme(
  value: unknown,
  takenIds: Iterable<string> = [],
): Theme | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const kind: ThemeKind | null =
    v.kind === "light" || v.kind === "dark" ? v.kind : null;
  const label =
    typeof v.label === "string" && v.label.trim()
      ? v.label.trim().slice(0, 60)
      : null;
  if (!kind || !label) return null;

  const base =
    kind === "dark"
      ? BUILTIN_THEMES_BY_ID[DEFAULT_DARK_THEME_ID]
      : BUILTIN_THEMES_BY_ID[DEFAULT_LIGHT_THEME_ID];
  const colors = { ...base.colors };
  const rawColors =
    v.colors && typeof v.colors === "object"
      ? (v.colors as Record<string, unknown>)
      : {};
  for (const key of THEME_COLOR_KEYS) {
    if (isColorValue(rawColors[key])) colors[key] = rawColors[key].trim();
  }

  const baseId = typeof v.id === "string" && v.id.trim() ? slugify(v.id) : slugify(label);
  return { id: uniqueThemeId(baseId, takenIds), label, kind, colors };
}

/**
 * Parse an imported theme document: a single theme object, a bare array, or a
 * `{ themes: [...] }` pack (the shape a theme repository would publish). Invalid
 * entries are skipped; ids are made unique against `existingIds` and each other.
 */
export function parseThemeImport(
  value: unknown,
  existingIds: Iterable<string> = [],
): Theme[] {
  const items: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { themes?: unknown }).themes)
      ? ((value as { themes: unknown[] }).themes)
      : [value];

  const taken = new Set<string>(existingIds);
  const themes: Theme[] = [];
  for (const item of items) {
    const theme = sanitizeTheme(item, taken);
    if (theme) {
      themes.push(theme);
      taken.add(theme.id);
    }
  }
  return themes;
}

/** Validate persisted custom themes (drops anything corrupt). */
export function sanitizeCustomThemes(raw: unknown): Theme[] {
  return Array.isArray(raw) ? parseThemeImport(raw) : [];
}

/**
 * Build a custom theme from editor input. When `id` is given the theme is being
 * edited in place (id preserved so the active-theme preference still resolves);
 * otherwise a fresh unique id is derived from the label.
 */
export function createCustomTheme(
  input: { id?: string; label: string; kind: ThemeKind; colors: ThemeColors },
  existingIds: Iterable<string> = [],
): Theme {
  const label = input.label.trim() || "Custom Theme";
  const id = input.id ?? uniqueThemeId(slugify(label), existingIds);
  return { id, label, kind: input.kind, colors: { ...input.colors } };
}

/** The JSON shape written by export / accepted by import (no internal flags). */
export function serializableTheme(theme: Theme): Omit<Theme, "builtin"> {
  return { id: theme.id, label: theme.label, kind: theme.kind, colors: theme.colors };
}
