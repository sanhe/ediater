import type { PanelBodyProps } from "../../layout/panelRegistry";
import { useWorkspace } from "../../app/workspace";
import { FileTree } from "./FileTree";

/**
 * Explorer panel body: a single-rooted project tree. Each explorer tab is
 * rooted at its own folder, so several projects can be open at once.
 */
export function ExplorerPanel({ panel }: PanelBodyProps) {
  const { openFile } = useWorkspace();
  if (panel.kind !== "explorer") return null;

  return <FileTree root={panel.root} showHidden={false} onOpenFile={openFile} />;
}
