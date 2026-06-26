import type { ComponentType } from "react";
import { panelTitle, type PanelKind, type PanelState } from "./panel";
import { ExplorerPanel } from "../panels/explorer/ExplorerPanel";
import { EditorPanel } from "../panels/editor/EditorPanel";
import { TerminalPanel } from "../panels/terminal/TerminalPanel";

/** Props passed to every panel body component. */
export interface PanelBodyProps {
  panel: PanelState;
}

/** Temporary placeholder until terminal/search bodies land in M2. */
function Placeholder({ panel }: PanelBodyProps) {
  return (
    <div className="panel-placeholder">
      <p className="muted">{panelTitle(panel)}</p>
      <p className="panel-placeholder-hint muted">coming soon</p>
    </div>
  );
}

/** Maps a panel kind to the React component that renders its body. */
export const panelRegistry: Record<PanelKind, ComponentType<PanelBodyProps>> = {
  explorer: ExplorerPanel,
  editor: EditorPanel,
  terminal: TerminalPanel,
  search: Placeholder,
};
