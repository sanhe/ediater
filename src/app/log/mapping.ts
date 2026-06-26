/**
 * Pure mappers from app-internal actions to log events.
 *
 * This is the ONLY place that knows how an internal SessionAction / Command
 * becomes a stable, AI-facing log verb + payload. Keeping it pure and total
 * (exhaustive switch, no default) means the type checker guarantees every new
 * SessionAction gets a log mapping.
 */

import type { SessionAction } from "../session/reducer";
import type { SessionData } from "../session/sessionData";
import type { PanelKind } from "../../layout/panel";
import type { PathScope } from "./config";
import { extOf, redactPath, type RedactContext } from "./redact";
import type {
  ActionPayload,
  ActionSource,
  ActionVerb,
  CommandVia,
  FileRef,
} from "./schema";

/** What the facade needs to emit an event derived from a mapper. */
export interface EventDescriptor {
  action: ActionVerb;
  source: ActionSource;
  payload?: ActionPayload;
  /**
   * When set, the event is collapsed last-wins by this key within collapseMs
   * (used for high-churn resize / active-tab actions).
   */
  collapseKey?: string;
}

/** Number of lines in a string (newline count + 1; "" -> 1). */
export function countLines(text: string): number {
  if (text.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) n += 1;
  }
  return n;
}

export function makeFileRef(
  path: string,
  scope: PathScope,
  ctx: RedactContext,
): FileRef {
  const ref: FileRef = { path: redactPath(path, scope, ctx) };
  const ext = extOf(path);
  if (ext) ref.ext = ext;
  return ref;
}

function hasPanelOfKind(state: SessionData, kind: PanelKind): boolean {
  return Object.values(state.panels).some((p) => p.kind === kind);
}

function assertNever(x: never): never {
  throw new Error(`unhandled SessionAction: ${JSON.stringify(x)}`);
}

/**
 * Map a dispatched SessionAction (with the *previous* state) to a log event.
 * `prev` is the state at dispatch time; flags like `reused`/`opened` are derived
 * from it. Next-state is never recomputed (the reducer stays the sole owner).
 */
export function sessionEvent(
  action: SessionAction,
  prev: SessionData,
  scope: PathScope,
  ctx: RedactContext,
): EventDescriptor {
  switch (action.type) {
    case "hydrate":
      return {
        action: "session.hydrate",
        source: "reducer",
        payload: {
          kind: "hydrate",
          restored: action.session.layout != null,
          panelCount: Object.keys(action.session.panels).length,
        },
      };

    case "setTheme":
      return {
        action: "theme.set",
        source: "reducer",
        payload: { kind: "theme", to: action.theme },
      };

    case "upsertCustomTheme":
      return {
        action: "theme.upsert",
        source: "reducer",
        payload: {
          kind: "themeEdit",
          themeId: action.theme.id,
          label: action.theme.label,
          themeKind: action.theme.kind,
        },
      };

    case "addImportedThemes":
      return {
        action: "theme.import",
        source: "reducer",
        payload: {
          kind: "themeImport",
          count: action.themes.length,
          ids: action.themes.map((t) => t.id),
        },
      };

    case "removeCustomTheme":
      return {
        action: "theme.remove",
        source: "reducer",
        payload: { kind: "themeEdit", themeId: action.id },
      };

    case "openFolderTab": {
      const reused = Object.values(prev.panels).some(
        (p) => p.kind === "explorer" && p.root === action.root,
      );
      return {
        action: "folder.open",
        source: "reducer",
        payload: {
          kind: "folder",
          root: redactPath(action.root, scope, ctx),
          reused,
        },
      };
    }

    case "openFileTab": {
      const reused = Object.values(prev.panels).some(
        (p) => p.kind === "editor" && p.path === action.path,
      );
      return {
        action: "file.open",
        source: "reducer",
        payload: {
          kind: "file",
          file: makeFileRef(action.path, scope, ctx),
          reused,
        },
      };
    }

    case "closePanel": {
      const panel = prev.panels[action.panelId];
      return {
        action: "panel.close",
        source: "reducer",
        payload: {
          kind: "panel",
          panelId: action.panelId,
          panelKind: panel?.kind,
          file:
            panel?.kind === "editor"
              ? makeFileRef(panel.path, scope, ctx)
              : undefined,
        },
      };
    }

    case "setActiveTab":
      return {
        action: "tab.activate",
        source: "reducer",
        payload: {
          kind: "tabActivate",
          groupId: action.groupId,
          panelId: action.panelId,
        },
        collapseKey: `tab.activate:${action.groupId}`,
      };

    case "setActiveGroup":
      return {
        action: "group.activate",
        source: "reducer",
        payload: { kind: "groupActivate", groupId: action.groupId },
        collapseKey: `group.activate:${action.groupId}`,
      };

    case "moveTab":
      return {
        action: "tab.move",
        source: "reducer",
        payload: {
          kind: "tabMove",
          panelId: action.panelId,
          targetGroup: action.targetGroupId,
          index: action.index,
        },
      };

    case "splitTab":
      return {
        action: "tab.split",
        source: "reducer",
        payload: {
          kind: "tabSplit",
          panelId: action.panelId,
          targetGroup: action.targetGroupId,
          edge: action.edge,
        },
      };

    case "resizeSplit":
      return {
        action: "split.resize",
        source: "reducer",
        payload: {
          kind: "splitResize",
          splitId: action.splitId,
          paneCount: action.sizes.length,
        },
        collapseKey: `split.resize:${action.splitId}`,
      };

    case "togglePanelKind":
      return {
        action: "panel.toggle",
        source: "reducer",
        payload: {
          kind: "panelToggle",
          panelKind: action.kind,
          // Toggle creates when none of the kind exists, else removes.
          opened: !hasPanelOfKind(prev, action.kind),
        },
      };

    default:
      return assertNever(action);
  }
}

/** Build the payload for a command execution. */
export function commandPayload(
  cmd: { id: string; title: string; keybinding?: string },
  via: CommandVia,
  keybinding?: string,
): Extract<ActionPayload, { kind: "command" }> {
  const payload: Extract<ActionPayload, { kind: "command" }> = {
    kind: "command",
    commandId: cmd.id,
    title: cmd.title,
    via,
  };
  const kb = keybinding ?? cmd.keybinding;
  if (kb) payload.keybinding = kb;
  return payload;
}

/** Build the payload for a batch of changed paths from the fs watcher. */
export function fsChangedPayload(
  paths: string[],
  sampleSize: number,
  scope: PathScope,
  ctx: RedactContext,
): Extract<ActionPayload, { kind: "fsChanged" }> {
  return {
    kind: "fsChanged",
    count: paths.length,
    sample: paths.slice(0, sampleSize).map((p) => redactPath(p, scope, ctx)),
  };
}
