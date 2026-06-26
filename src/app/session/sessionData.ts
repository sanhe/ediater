/**
 * SessionData is the single source of truth for the app's persisted state.
 *
 * Serializable (plain JSON); the Rust backend stores it as an opaque blob. Open
 * folders and files are encoded as panels (explorer/editor tabs) inside the
 * docking layout, so there is no single "project root" — several folders can be
 * open as tabs at once.
 */

import type { LayoutNode } from "../../layout/layout";
import type { PanelState } from "../../layout/panel";
import {
  sanitizeCustomThemes,
  SYSTEM_THEME,
  type Theme,
  type ThemePreference,
} from "../theme/themes";

export const SESSION_SCHEMA_VERSION = 3;

export interface SessionData {
  version: number;
  ui: {
    /** A theme id, or "system" to follow the OS colour scheme. */
    theme: ThemePreference;
    /** User-authored / imported themes, selectable alongside the built-ins. */
    customThemes: Theme[];
    /** The focused group (where new files/folders open as tabs). */
    activeGroupId: string | null;
  };
  /** The docking layout, or null when no workspace is open. */
  layout: LayoutNode | null;
  /** Panel state keyed by panel id; groups in `layout` reference these. */
  panels: Record<string, PanelState>;
}

export function defaultSession(): SessionData {
  return {
    version: SESSION_SCHEMA_VERSION,
    ui: { theme: SYSTEM_THEME, customThemes: [], activeGroupId: null },
    layout: null,
    panels: {},
  };
}

/**
 * Coerce an unknown persisted blob into a valid SessionData. Theme is always
 * salvaged; structured workspace state is only trusted from a matching schema
 * version, otherwise we start with a clean workspace.
 */
export function migrateSession(raw: unknown): SessionData {
  const base = defaultSession();
  if (!raw || typeof raw !== "object") return base;

  const data = raw as Record<string, unknown>;
  const ui = data.ui as
    | { theme?: unknown; customThemes?: unknown; activeGroupId?: unknown }
    | undefined;
  // Any non-empty string is kept; resolveTheme falls back gracefully for ids
  // that no longer exist, so a removed custom theme can't strand the app.
  const theme =
    typeof ui?.theme === "string" && ui.theme ? ui.theme : base.ui.theme;
  const customThemes = sanitizeCustomThemes(ui?.customThemes);

  if (data.version === SESSION_SCHEMA_VERSION) {
    const activeGroupId =
      typeof ui?.activeGroupId === "string" ? ui.activeGroupId : null;
    const layout = (data.layout as LayoutNode | null | undefined) ?? null;
    const panels =
      (data.panels as Record<string, PanelState> | undefined) ?? {};
    return {
      version: SESSION_SCHEMA_VERSION,
      ui: { theme, customThemes, activeGroupId },
      layout,
      panels,
    };
  }

  return { ...base, ui: { ...base.ui, theme, customThemes } };
}
