import { useMemo } from "react";
import { useWorkspace } from "../app/workspace";
import { useDocuments } from "../panels/editor/documents";
import { findGroupById } from "../layout/layout";
import type { Command } from "./types";

/**
 * Builds the live command list from the current workspace/documents context.
 * This is the single registry the palette and keybindings draw from; plugins
 * will contribute additional commands here in a later milestone.
 */
export function useCommands(): Command[] {
  const { session, dispatch, openFolder } = useWorkspace();
  const docs = useDocuments();

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

    return [
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
        title: "Toggle Color Theme",
        category: "View",
        run: () =>
          dispatch({
            type: "setTheme",
            theme: session.ui.theme === "dark" ? "light" : "dark",
          }),
      },
    ];
  }, [session, dispatch, openFolder, docs]);
}
