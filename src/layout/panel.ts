/**
 * Panel identity & payload. A panel is a single dockable view that lives as a
 * tab inside a group. Each kind carries the state it needs (an explorer tab is
 * rooted at one folder; an editor tab shows one file).
 */

export type PanelKind = "explorer" | "editor" | "terminal" | "search";

interface PanelCommon {
  id: string;
  kind: PanelKind;
}

export interface ExplorerPanelState extends PanelCommon {
  kind: "explorer";
  root: string;
}

export interface EditorPanelState extends PanelCommon {
  kind: "editor";
  path: string;
}

export interface TerminalPanelState extends PanelCommon {
  kind: "terminal";
}

export interface SearchPanelState extends PanelCommon {
  kind: "search";
}

export type PanelState =
  | ExplorerPanelState
  | EditorPanelState
  | TerminalPanelState
  | SearchPanelState;

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** The label shown on a panel's tab. */
export function panelTitle(panel: PanelState): string {
  switch (panel.kind) {
    case "explorer":
      return basename(panel.root) || "Explorer";
    case "editor":
      return basename(panel.path);
    case "terminal":
      return "Terminal";
    case "search":
      return "Search";
  }
}
