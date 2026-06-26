import { useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { useWorkspace } from "../../app/workspace";
import {
  cancelSearch,
  searchFiles,
  searchText,
  type FuzzyMatch,
  type SearchEvent,
} from "../../app/ipc/commands";
import "./search.css";

type Mode = "text" | "files";

interface TextMatch {
  file: string;
  line: number;
  column: number;
  text: string;
}

interface TextStatus {
  matched: number;
  truncated: boolean;
  running: boolean;
  error?: string;
}

function group(matches: TextMatch[]): { file: string; items: TextMatch[] }[] {
  const map = new Map<string, TextMatch[]>();
  for (const m of matches) {
    const arr = map.get(m.file);
    if (arr) arr.push(m);
    else map.set(m.file, [m]);
  }
  return Array.from(map, ([file, items]) => ({ file, items }));
}

function relPath(file: string, root: string | null): string {
  if (root && file.startsWith(root)) {
    return file.slice(root.length).replace(/^[\\/]/, "");
  }
  return file;
}

/**
 * Project search panel: "Text" (streaming, ripgrep-grade, gitignore-aware) and
 * "Files" (fuzzy filename). Results jump to the file (and line) in the editor.
 * Searches the first open folder.
 */
export function SearchPanel() {
  const { session, openFile } = useWorkspace();
  const [mode, setMode] = useState<Mode>("text");
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [groups, setGroups] = useState<{ file: string; items: TextMatch[] }[]>(
    [],
  );
  const [status, setStatus] = useState<TextStatus | null>(null);
  const [files, setFiles] = useState<FuzzyMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const root = useMemo(() => {
    const explorer = Object.values(session.panels).find(
      (p) => p.kind === "explorer",
    );
    return explorer && explorer.kind === "explorer" ? explorer.root : null;
  }, [session.panels]);

  // Text search: debounced, streamed, cancel-on-change.
  useEffect(() => {
    if (mode !== "text") {
      setGroups([]);
      setStatus(null);
      return;
    }
    const q = query.trim();
    if (!q || !root) {
      setGroups([]);
      setStatus(null);
      return;
    }

    let disposed = false;
    const searchId = `search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const matches: TextMatch[] = [];
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      if (!disposed) setGroups(group(matches));
    };

    const debounce = window.setTimeout(() => {
      const channel = new Channel<SearchEvent>();
      channel.onmessage = (ev) => {
        if (disposed) return;
        if (ev.kind === "match") {
          matches.push({
            file: ev.file,
            line: ev.line,
            column: ev.column,
            text: ev.text,
          });
          if (!flushScheduled) {
            flushScheduled = true;
            window.setTimeout(flush, 100);
          }
        } else if (ev.kind === "done") {
          flush();
          setStatus({
            matched: ev.matched,
            truncated: ev.truncated,
            running: false,
          });
        } else if (ev.kind === "error") {
          setStatus({
            matched: 0,
            truncated: false,
            running: false,
            error: ev.message,
          });
        }
      };
      setStatus({ matched: 0, truncated: false, running: true });
      void searchText(searchId, q, root, { caseSensitive, regex }, channel);
    }, 200);

    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      void cancelSearch(searchId);
    };
  }, [query, mode, root, caseSensitive, regex]);

  // Fuzzy filename search: debounced.
  useEffect(() => {
    if (mode !== "files") {
      setFiles([]);
      return;
    }
    const q = query.trim();
    if (!q || !root) {
      setFiles([]);
      return;
    }
    let disposed = false;
    const t = window.setTimeout(() => {
      void searchFiles(q, root, 100)
        .then((r) => {
          if (!disposed) setFiles(r);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      disposed = true;
      window.clearTimeout(t);
    };
  }, [query, mode, root]);

  if (!root) {
    return (
      <div className="search-empty muted">Open a folder to search.</div>
    );
  }

  return (
    <div className="search-panel">
      <div className="search-controls">
        <div className="search-mode">
          <button
            className={`search-tab${mode === "text" ? " active" : ""}`}
            onClick={() => setMode("text")}
          >
            Text
          </button>
          <button
            className={`search-tab${mode === "files" ? " active" : ""}`}
            onClick={() => setMode("files")}
          >
            Files
          </button>
        </div>
        <input
          ref={inputRef}
          className="search-input"
          placeholder={mode === "text" ? "Find in folder…" : "Find file…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        {mode === "text" && (
          <div className="search-toggles">
            <button
              className={`search-toggle${caseSensitive ? " active" : ""}`}
              title="Match case"
              onClick={() => setCaseSensitive((v) => !v)}
            >
              Aa
            </button>
            <button
              className={`search-toggle${regex ? " active" : ""}`}
              title="Use regular expression"
              onClick={() => setRegex((v) => !v)}
            >
              .*
            </button>
          </div>
        )}
      </div>

      <div className="search-results">
        {mode === "text" ? (
          <>
            {status?.error && (
              <div className="search-error">{status.error}</div>
            )}
            {status && !status.error && (
              <div className="search-status muted">
                {status.running
                  ? "Searching…"
                  : `${status.matched} result${status.matched === 1 ? "" : "s"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`}
                {status.truncated ? " (showing first 5000)" : ""}
              </div>
            )}
            {groups.map((g) => (
              <div className="search-group" key={g.file}>
                <div className="search-file" title={g.file}>
                  {relPath(g.file, root)}
                </div>
                {g.items.map((m, i) => (
                  <div
                    className="search-match"
                    key={`${g.file}:${m.line}:${i}`}
                    onClick={() => openFile(g.file, m.line)}
                    title={`${relPath(g.file, root)}:${m.line}`}
                  >
                    <span className="search-line-no">{m.line}</span>
                    <span className="search-line-text">{m.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        ) : (
          <>
            {files.map((f) => (
              <div
                className="search-file-row"
                key={f.path}
                onClick={() => openFile(f.path)}
                title={f.path}
              >
                {f.rel}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
