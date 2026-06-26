/** User-configurable settings, persisted in the session. */

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  formatOnSave: boolean;
}

export interface FilesSettings {
  showHidden: boolean;
}

export interface Settings {
  editor: EditorSettings;
  files: FilesSettings;
  /** Per-command keybinding overrides: commandId → combo (e.g. "Mod+Shift+f"). */
  keybindings: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  editor: { fontSize: 13, tabSize: 2, formatOnSave: false },
  files: { showHidden: false },
  keybindings: {},
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Coerce an unknown persisted blob into valid Settings, filling defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as {
    editor?: Partial<EditorSettings>;
    files?: Partial<FilesSettings>;
    keybindings?: unknown;
  };
  const keybindings: Record<string, string> = {};
  if (r.keybindings && typeof r.keybindings === "object") {
    for (const [k, v] of Object.entries(r.keybindings as Record<string, unknown>)) {
      if (typeof v === "string") keybindings[k] = v;
    }
  }
  return {
    editor: {
      fontSize: clampInt(r.editor?.fontSize, 8, 32, DEFAULT_SETTINGS.editor.fontSize),
      tabSize: clampInt(r.editor?.tabSize, 1, 8, DEFAULT_SETTINGS.editor.tabSize),
      formatOnSave: r.editor?.formatOnSave === true,
    },
    files: { showHidden: r.files?.showHidden === true },
    keybindings,
  };
}
