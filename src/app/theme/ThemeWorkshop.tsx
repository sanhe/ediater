import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspace } from "../workspace";
import { useResolvedTheme, useAllThemes } from "./ThemeContext";
import { ThemeEditor } from "./ThemeEditor";
import { exportThemeToFile, importThemesFromFile } from "./themeIo";
import { indexThemes, type Theme } from "./themes";

interface ThemeWorkshopValue {
  /** Open the theme editor, seeded from `baseThemeId` (defaults to the active theme). */
  openEditor: (baseThemeId?: string) => void;
  /** Pick a `.json` theme/pack file and install the themes it contains. */
  importThemes: () => void;
  /** Save `theme` to a `.json` file the user can share. */
  exportTheme: (theme: Theme) => void;
  /** Delete a custom theme. */
  deleteTheme: (theme: Theme) => void;
}

const ThemeWorkshopContext = createContext<ThemeWorkshopValue | null>(null);

export function useThemeWorkshop(): ThemeWorkshopValue {
  const ctx = useContext(ThemeWorkshopContext);
  if (!ctx) {
    throw new Error("useThemeWorkshop must be used within ThemeWorkshopProvider");
  }
  return ctx;
}

interface EditorState {
  seed: Theme;
  editing: Theme | null;
}

/**
 * Owns the theme-authoring surface: the editor modal, file import/export, and a
 * transient toast for results. Mounted inside ThemeController + WorkspaceProvider
 * so both the titlebar and the command palette can drive it.
 */
export function ThemeWorkshopProvider({ children }: { children: ReactNode }) {
  const { dispatch } = useWorkspace();
  const resolved = useResolvedTheme();
  const themes = useAllThemes();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customIds = useMemo(
    () => themes.filter((t) => !t.builtin).map((t) => t.id),
    [themes],
  );
  const themesById = useMemo(() => indexThemes(themes), [themes]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const openEditor = useCallback(
    (baseThemeId?: string) => {
      const base = (baseThemeId && themesById[baseThemeId]) || resolved;
      setEditor({ seed: base, editing: base.builtin ? null : base });
    },
    [resolved, themesById],
  );

  const handleSave = useCallback(
    (theme: Theme) => {
      dispatch({ type: "upsertCustomTheme", theme });
      dispatch({ type: "setTheme", theme: theme.id });
      setEditor(null);
      notify(`Saved theme "${theme.label}".`);
    },
    [dispatch, notify],
  );

  const importThemes = useCallback(() => {
    void (async () => {
      try {
        const imported = await importThemesFromFile(customIds);
        if (imported.length === 0) return; // cancelled
        dispatch({ type: "addImportedThemes", themes: imported });
        dispatch({ type: "setTheme", theme: imported[0].id });
        notify(
          imported.length === 1
            ? `Imported theme "${imported[0].label}".`
            : `Imported ${imported.length} themes.`,
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not import theme.");
      }
    })();
  }, [customIds, dispatch, notify]);

  const exportTheme = useCallback(
    (theme: Theme) => {
      void (async () => {
        try {
          const saved = await exportThemeToFile(theme);
          if (saved) notify(`Exported theme "${theme.label}".`);
        } catch (err) {
          notify(err instanceof Error ? err.message : "Could not export theme.");
        }
      })();
    },
    [notify],
  );

  const deleteTheme = useCallback(
    (theme: Theme) => {
      dispatch({ type: "removeCustomTheme", id: theme.id });
      notify(`Deleted theme "${theme.label}".`);
    },
    [dispatch, notify],
  );

  const value = useMemo<ThemeWorkshopValue>(
    () => ({ openEditor, importThemes, exportTheme, deleteTheme }),
    [openEditor, importThemes, exportTheme, deleteTheme],
  );

  return (
    <ThemeWorkshopContext.Provider value={value}>
      {children}
      {editor && (
        <ThemeEditor
          seed={editor.seed}
          editing={editor.editing}
          existingIds={customIds}
          onSave={handleSave}
          onCancel={() => setEditor(null)}
        />
      )}
      {toast && <div className="theme-toast">{toast}</div>}
    </ThemeWorkshopContext.Provider>
  );
}
