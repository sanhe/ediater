import { useEffect } from "react";
import type { PanelBodyProps } from "../../layout/panelRegistry";
import { useResolvedTheme } from "../../app/theme/ThemeContext";
import { useDocuments } from "./documents";
import { CodeMirrorView } from "./CodeMirrorView";
import "./editor.css";

/**
 * Editor panel body: one file per panel (the dock group's tab strip provides
 * the tabs). The buffer lives in the global documents store, keyed by path.
 */
export function EditorPanel({ panel }: PanelBodyProps) {
  const { kind } = useResolvedTheme();
  const docs = useDocuments();
  const path = panel.kind === "editor" ? panel.path : null;

  useEffect(() => {
    if (path) docs.ensureOpen(path);
  }, [path, docs]);

  if (!path) return null;
  const doc = docs.docs[path];

  return (
    <div className="editor-panel">
      <div className="editor-body">
        {!doc || doc.loading ? (
          <div className="editor-empty muted">Loading…</div>
        ) : doc.error ? (
          <div className="editor-empty editor-error">{doc.error}</div>
        ) : (
          <CodeMirrorView
            key={path}
            path={path}
            initialContent={doc.content}
            readonly={doc.readonly}
            kind={kind}
            onChange={(content) => docs.update(path, content)}
            onSave={() => void docs.save(path)}
          />
        )}
      </div>
    </div>
  );
}
