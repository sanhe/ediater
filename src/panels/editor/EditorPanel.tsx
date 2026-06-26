import { useEffect } from "react";
import type { PanelBodyProps } from "../../layout/panelRegistry";
import { useResolvedTheme } from "../../app/theme/ThemeContext";
import { useWorkspace } from "../../app/workspace";
import { formatDocument } from "../../app/ipc/commands";
import { useDocuments } from "./documents";
import { CodeMirrorView } from "./CodeMirrorView";
import { requestSetText } from "./reveal";
import "./editor.css";

/**
 * Editor panel body: one file per panel (the dock group's tab strip provides
 * the tabs). The buffer lives in the global documents store, keyed by path.
 */
export function EditorPanel({ panel }: PanelBodyProps) {
  const { kind } = useResolvedTheme();
  const { session } = useWorkspace();
  const docs = useDocuments();
  const path = panel.kind === "editor" ? panel.path : null;
  const editor = session.settings.editor;

  useEffect(() => {
    if (path) docs.ensureOpen(path);
  }, [path, docs]);

  if (!path) return null;
  const filePath = path;
  const doc = docs.docs[filePath];

  const handleSave = async () => {
    let content = docs.docs[filePath]?.content;
    if (content == null) return;
    if (editor.formatOnSave) {
      const languageId = filePath.split(".").pop() ?? "";
      try {
        const formatted = await formatDocument(filePath, content, languageId);
        if (typeof formatted === "string" && formatted !== content) {
          content = formatted;
          requestSetText(filePath, formatted);
        }
      } catch {
        /* no formatter / error — save unformatted */
      }
    }
    void docs.save(filePath, content);
  };

  return (
    <div className="editor-panel">
      <div className="editor-body">
        {!doc || doc.loading ? (
          <div className="editor-empty muted">Loading…</div>
        ) : doc.error ? (
          <div className="editor-empty editor-error">{doc.error}</div>
        ) : (
          <CodeMirrorView
            key={filePath}
            path={filePath}
            initialContent={doc.content}
            readonly={doc.readonly}
            kind={kind}
            fontSize={editor.fontSize}
            tabSize={editor.tabSize}
            onChange={(content) => docs.update(filePath, content)}
            onSave={() => void handleSave()}
          />
        )}
      </div>
    </div>
  );
}
