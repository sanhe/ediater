import { lazy, type ComponentType } from "react";
import type { PanelKind, PanelState } from "./panel";

/** Props passed to every panel body component. */
export interface PanelBodyProps {
  panel: PanelState;
}

// Panel bodies are lazy-loaded so their heavy deps (CodeMirror, xterm, the file
// tree, Shiki) land in separate chunks loaded on first use, not in the entry.
const ExplorerPanel = lazy(() =>
  import("../panels/explorer/ExplorerPanel").then((m) => ({
    default: m.ExplorerPanel,
  })),
);
const EditorPanel = lazy(() =>
  import("../panels/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })),
);
const TerminalPanel = lazy(() =>
  import("../panels/terminal/TerminalPanel").then((m) => ({
    default: m.TerminalPanel,
  })),
);
const SearchPanel = lazy(() =>
  import("../panels/search/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);
const AiPanel = lazy(() =>
  import("../panels/ai/AiPanel").then((m) => ({ default: m.AiPanel })),
);

/** Maps a panel kind to the (lazy) React component that renders its body. */
export const panelRegistry: Record<PanelKind, ComponentType<PanelBodyProps>> = {
  explorer: ExplorerPanel,
  editor: EditorPanel,
  terminal: TerminalPanel,
  search: SearchPanel,
  ai: AiPanel,
};
