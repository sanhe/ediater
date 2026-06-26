import type { ComponentType } from "react";
import type { PanelKind, PanelState } from "./panel";
import { ExplorerPanel } from "../panels/explorer/ExplorerPanel";
import { EditorPanel } from "../panels/editor/EditorPanel";
import { TerminalPanel } from "../panels/terminal/TerminalPanel";
import { SearchPanel } from "../panels/search/SearchPanel";

/** Props passed to every panel body component. */
export interface PanelBodyProps {
  panel: PanelState;
}

/** Maps a panel kind to the React component that renders its body. */
export const panelRegistry: Record<PanelKind, ComponentType<PanelBodyProps>> = {
  explorer: ExplorerPanel,
  editor: EditorPanel,
  terminal: TerminalPanel,
  search: SearchPanel,
};
