import type { SessionData } from "./sessionData";
import { SYSTEM_THEME, type Theme, type ThemePreference } from "../theme/themes";
import {
  addPanelToGroup,
  findGroupById,
  findGroupOfPanel,
  firstGroupId,
  group,
  movePanelToGroup,
  removePanel,
  setActivePanel,
  splitPanelToGroup,
  updateSplitSizes,
  type LayoutNode,
  type SplitEdge,
} from "../../layout/layout";
import { newId } from "../../layout/ids";
import type { PanelKind, PanelState } from "../../layout/panel";

/**
 * All mutations to SessionData flow through this pure reducer. The docking
 * actions delegate to the pure tab-group algebra in layout.ts.
 */
export type SessionAction =
  | { type: "hydrate"; session: SessionData }
  | { type: "setTheme"; theme: ThemePreference }
  | { type: "upsertCustomTheme"; theme: Theme }
  | { type: "addImportedThemes"; themes: Theme[] }
  | { type: "removeCustomTheme"; id: string }
  | { type: "openFolderTab"; root: string }
  | { type: "openFileTab"; path: string }
  | { type: "closePanel"; panelId: string }
  | { type: "setActiveTab"; groupId: string; panelId: string }
  | { type: "setActiveGroup"; groupId: string }
  | { type: "moveTab"; panelId: string; targetGroupId: string; index?: number }
  | {
      type: "splitTab";
      panelId: string;
      targetGroupId: string;
      edge: SplitEdge;
    }
  | { type: "resizeSplit"; splitId: string; sizes: number[] }
  | { type: "togglePanelKind"; kind: PanelKind };

const splitId = () => newId("split");

function panelsOf(state: SessionData): PanelState[] {
  return Object.values(state.panels);
}

function firstGroupIdOrNull(layout: LayoutNode | null): string | null {
  return layout ? firstGroupId(layout) : null;
}

/** Group id of the first panel of a given kind, if any. */
function groupOfFirstKind(state: SessionData, kind: PanelKind): string | null {
  const panel = panelsOf(state).find((p) => p.kind === kind);
  if (!panel || !state.layout) return null;
  return findGroupOfPanel(state.layout, panel.id)?.id ?? null;
}

/** Preferred group to open a new editor tab into. */
function editorTargetGroup(state: SessionData): string | null {
  if (!state.layout) return null;
  const activeId = state.ui.activeGroupId;
  if (activeId) {
    const g = findGroupById(state.layout, activeId);
    if (g && g.panelIds.some((id) => state.panels[id]?.kind === "editor")) {
      return g.id;
    }
  }
  return groupOfFirstKind(state, "editor");
}

function makePanel(kind: PanelKind, key?: string): PanelState {
  const id = newId(kind);
  switch (kind) {
    case "explorer":
      return { id, kind, root: key ?? "" };
    case "editor":
      return { id, kind, path: key ?? "" };
    case "terminal":
      return { id, kind };
    case "search":
      return { id, kind };
  }
}

/** Activate an existing panel and focus its group. */
function activatePanel(state: SessionData, panelId: string): SessionData {
  if (!state.layout) return state;
  const g = findGroupOfPanel(state.layout, panelId);
  if (!g) return state;
  return {
    ...state,
    layout: setActivePanel(state.layout, g.id, panelId),
    ui: { ...state.ui, activeGroupId: g.id },
  };
}

/** Place a brand-new panel into the layout and focus it. */
function placePanel(
  state: SessionData,
  panel: PanelState,
  fallbackTargetGroupId: string | null,
  edge: SplitEdge,
): SessionData {
  const panels = { ...state.panels, [panel.id]: panel };

  if (!state.layout) {
    const g = group(newId("group"), [panel.id], panel.id);
    return { ...state, layout: g, panels, ui: { ...state.ui, activeGroupId: g.id } };
  }

  if (fallbackTargetGroupId && findGroupById(state.layout, fallbackTargetGroupId)) {
    // Tabify into an existing group of the same area.
    const layout = addPanelToGroup(state.layout, fallbackTargetGroupId, panel.id, {
      activate: true,
    });
    return {
      ...state,
      layout,
      panels,
      ui: { ...state.ui, activeGroupId: fallbackTargetGroupId },
    };
  }

  // Otherwise split a new group off an anchor group.
  const anchor =
    (state.ui.activeGroupId &&
      findGroupById(state.layout, state.ui.activeGroupId)?.id) ||
    firstGroupId(state.layout);
  const layout = splitPanelToGroup(state.layout, panel.id, anchor, edge, splitId);
  const newGroupId = findGroupOfPanel(layout, panel.id)?.id ?? anchor;
  return { ...state, layout, panels, ui: { ...state.ui, activeGroupId: newGroupId } };
}

function removePanelById(state: SessionData, panelId: string): SessionData {
  const layout = state.layout ? removePanel(state.layout, panelId) : null;
  const panels = { ...state.panels };
  delete panels[panelId];
  let activeGroupId = state.ui.activeGroupId;
  if (!layout) {
    activeGroupId = null;
  } else if (activeGroupId && !findGroupById(layout, activeGroupId)) {
    activeGroupId = firstGroupIdOrNull(layout);
  }
  return { ...state, layout, panels, ui: { ...state.ui, activeGroupId } };
}

export function sessionReducer(
  state: SessionData,
  action: SessionAction,
): SessionData {
  switch (action.type) {
    case "hydrate":
      return action.session;

    case "setTheme":
      return { ...state, ui: { ...state.ui, theme: action.theme } };

    case "upsertCustomTheme": {
      const exists = state.ui.customThemes.some(
        (t) => t.id === action.theme.id,
      );
      const customThemes = exists
        ? state.ui.customThemes.map((t) =>
            t.id === action.theme.id ? action.theme : t,
          )
        : [...state.ui.customThemes, action.theme];
      return { ...state, ui: { ...state.ui, customThemes } };
    }

    case "addImportedThemes":
      if (action.themes.length === 0) return state;
      return {
        ...state,
        ui: {
          ...state.ui,
          customThemes: [...state.ui.customThemes, ...action.themes],
        },
      };

    case "removeCustomTheme": {
      const customThemes = state.ui.customThemes.filter(
        (t) => t.id !== action.id,
      );
      // If the deleted theme was active, fall back to following the system.
      const theme = state.ui.theme === action.id ? SYSTEM_THEME : state.ui.theme;
      return { ...state, ui: { ...state.ui, customThemes, theme } };
    }

    case "openFolderTab": {
      const existing = panelsOf(state).find(
        (p) => p.kind === "explorer" && p.root === action.root,
      );
      if (existing) return activatePanel(state, existing.id);
      const panel = makePanel("explorer", action.root);
      return placePanel(state, panel, groupOfFirstKind(state, "explorer"), "left");
    }

    case "openFileTab": {
      const existing = panelsOf(state).find(
        (p) => p.kind === "editor" && p.path === action.path,
      );
      if (existing) return activatePanel(state, existing.id);
      const panel = makePanel("editor", action.path);
      return placePanel(state, panel, editorTargetGroup(state), "right");
    }

    case "closePanel":
      return removePanelById(state, action.panelId);

    case "setActiveTab":
      if (!state.layout) return state;
      return {
        ...state,
        layout: setActivePanel(state.layout, action.groupId, action.panelId),
        ui: { ...state.ui, activeGroupId: action.groupId },
      };

    case "setActiveGroup":
      return { ...state, ui: { ...state.ui, activeGroupId: action.groupId } };

    case "moveTab": {
      if (!state.layout) return state;
      const layout = movePanelToGroup(
        state.layout,
        action.panelId,
        action.targetGroupId,
        action.index,
      );
      return {
        ...state,
        layout,
        ui: { ...state.ui, activeGroupId: action.targetGroupId },
      };
    }

    case "splitTab": {
      if (!state.layout) return state;
      const layout = splitPanelToGroup(
        state.layout,
        action.panelId,
        action.targetGroupId,
        action.edge,
        splitId,
      );
      const newGroupId =
        findGroupOfPanel(layout, action.panelId)?.id ?? state.ui.activeGroupId;
      return { ...state, layout, ui: { ...state.ui, activeGroupId: newGroupId } };
    }

    case "resizeSplit":
      if (!state.layout) return state;
      return {
        ...state,
        layout: updateSplitSizes(state.layout, action.splitId, action.sizes),
      };

    case "togglePanelKind": {
      const existing = panelsOf(state).find((p) => p.kind === action.kind);
      if (existing) return removePanelById(state, existing.id);

      const panel = makePanel(action.kind);
      if (action.kind === "terminal") {
        const anchor = editorTargetGroup(state);
        return placePanelSplit(state, panel, anchor, "bottom");
      }
      // search
      const anchor = groupOfFirstKind(state, "explorer");
      return placePanelSplit(state, panel, anchor, "left");
    }

    default:
      return state;
  }
}

/**
 * Place a new panel by splitting a new group off an anchor group (always a new
 * group, never tabbed into an existing one) — used for terminal/search so they
 * appear as their own region by default.
 */
function placePanelSplit(
  state: SessionData,
  panel: PanelState,
  anchorGroupId: string | null,
  edge: SplitEdge,
): SessionData {
  const panels = { ...state.panels, [panel.id]: panel };
  if (!state.layout) {
    const g = group(newId("group"), [panel.id], panel.id);
    return { ...state, layout: g, panels, ui: { ...state.ui, activeGroupId: g.id } };
  }
  const anchor =
    (anchorGroupId && findGroupById(state.layout, anchorGroupId)?.id) ||
    firstGroupId(state.layout);
  const layout = splitPanelToGroup(state.layout, panel.id, anchor, edge, splitId);
  const newGroupId = findGroupOfPanel(layout, panel.id)?.id ?? anchor;
  return { ...state, layout, panels, ui: { ...state.ui, activeGroupId: newGroupId } };
}
