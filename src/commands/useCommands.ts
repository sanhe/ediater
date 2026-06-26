import { useMemo } from "react";
import { useWorkspace } from "../app/workspace";
import { useDocuments } from "../panels/editor/documents";
import { useResolvedTheme, useAllThemes } from "../app/theme/ThemeContext";
import { useThemeWorkshop } from "../app/theme/ThemeWorkshop";
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  SYSTEM_THEME,
} from "../app/theme/themes";
import { findGroupById } from "../layout/layout";
import { log } from "../app/log/actionLog";
import type { Command } from "./types";

/**
 * Builds the live command list from the current workspace/documents context.
 * This is the single registry the palette and keybindings draw from; plugins
 * will contribute additional commands here in a later milestone.
 */
export function useCommands(): Command[] {
  const { session, dispatch, openFolder } = useWorkspace();
  const docs = useDocuments();
  const resolvedTheme = useResolvedTheme();
  const themes = useAllThemes();
  const workshop = useThemeWorkshop();

  return useMemo<Command[]>(() => {
    // Prefer the active group's file; fall back to any open editor.
    const activeGroup =
      session.ui.activeGroupId && session.layout
        ? findGroupById(session.layout, session.ui.activeGroupId)
        : null;
    const activeGroupPanel = activeGroup
      ? session.panels[activeGroup.activePanelId]
      : undefined;
    const fallbackEditor = Object.values(session.panels).find(
      (p) => p.kind === "editor",
    );
    const activePath =
      activeGroupPanel?.kind === "editor"
        ? activeGroupPanel.path
        : fallbackEditor?.kind === "editor"
          ? fallbackEditor.path
          : null;

    const commands: Command[] = [
      {
        id: "workbench.openFolder",
        title: "Open Folder…",
        category: "File",
        run: () => void openFolder(),
      },
      {
        id: "file.save",
        title: "Save File",
        category: "File",
        run: () => {
          if (activePath) void docs.save(activePath);
        },
      },
      {
        id: "view.toggleTerminal",
        title: "Toggle Terminal",
        category: "View",
        keybinding: "Mod+`",
        run: () => dispatch({ type: "togglePanelKind", kind: "terminal" }),
      },
      {
        id: "view.toggleSearch",
        title: "Toggle Search",
        category: "View",
        keybinding: "Mod+Shift+f",
        run: () => dispatch({ type: "togglePanelKind", kind: "search" }),
      },
      {
        id: "view.toggleTheme",
        title: "Toggle Light/Dark Theme",
        category: "View",
        run: () =>
          dispatch({
            type: "setTheme",
            theme:
              resolvedTheme.kind === "dark"
                ? DEFAULT_LIGHT_THEME_ID
                : DEFAULT_DARK_THEME_ID,
          }),
      },
      {
        id: "preferences.theme.new",
        title: "New Custom Theme…",
        category: "Preferences",
        run: () => workshop.openEditor(),
      },
      {
        id: "preferences.theme.customize",
        title: "Customize Current Theme…",
        category: "Preferences",
        run: () => workshop.openEditor(resolvedTheme.id),
      },
      {
        id: "preferences.theme.import",
        title: "Import Theme from File…",
        category: "Preferences",
        run: () => workshop.importThemes(),
      },
      {
        id: "preferences.theme.export",
        title: "Export Current Theme…",
        category: "Preferences",
        run: () => workshop.exportTheme(resolvedTheme),
      },
      {
        id: "preferences.theme.system",
        title: "Color Theme: System",
        category: "Preferences",
        run: () => dispatch({ type: "setTheme", theme: SYSTEM_THEME }),
      },
      ...themes.map(
        (t): Command => ({
          id: `preferences.theme.set.${t.id}`,
          title: `Color Theme: ${t.label}`,
          category: "Preferences",
          run: () => dispatch({ type: "setTheme", theme: t.id }),
        }),
      ),
      ...themes
        .filter((t) => !t.builtin)
        .map(
          (t): Command => ({
            id: `preferences.theme.delete.${t.id}`,
            title: `Delete Custom Theme: ${t.label}`,
            category: "Preferences",
            run: () => workshop.deleteTheme(t),
          }),
        ),
    ];

    // Wrap every command so palette and keybinding executions both record a
    // `command.run` event whose seq becomes the cause of the dispatches it fires.
    return commands.map((c) => ({ ...c, run: () => log.command(c, c.run) }));
  }, [session, dispatch, openFolder, docs, resolvedTheme, themes, workshop]);
}
