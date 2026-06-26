import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readFile, writeFile } from "../../app/ipc/commands";

/**
 * An open editor document. Buffers are global and keyed by absolute path so the
 * same file opened in two editor panels shares one buffer + dirty state.
 * Content is in-memory only (not persisted in the session).
 */
export interface OpenDoc {
  path: string;
  content: string;
  baseVersion: number;
  dirty: boolean;
  readonly: boolean;
  loading: boolean;
  error?: string;
}

interface DocumentsApi {
  docs: Record<string, OpenDoc>;
  /** Load the file if not already open (idempotent). */
  ensureOpen: (path: string) => void;
  /** Update buffer content from an editor edit (marks dirty). */
  update: (path: string, content: string) => void;
  /** Persist the buffer to disk. */
  save: (path: string) => Promise<void>;
  /** Drop the in-memory buffer. */
  close: (path: string) => void;
}

const DocumentsContext = createContext<DocumentsApi | null>(null);

export function useDocuments(): DocumentsApi {
  const ctx = useContext(DocumentsContext);
  if (!ctx) {
    throw new Error("useDocuments must be used within DocumentsProvider");
  }
  return ctx;
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [docs, setDocs] = useState<Record<string, OpenDoc>>({});
  // Track in-flight loads so ensureOpen is idempotent across rapid calls.
  const loadingRef = useRef<Set<string>>(new Set());
  // Latest docs snapshot, so `save` reads current content without being
  // re-created on every keystroke.
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const patch = useCallback((path: string, partial: Partial<OpenDoc>) => {
    setDocs((prev) => {
      const existing = prev[path];
      if (!existing) return prev;
      return { ...prev, [path]: { ...existing, ...partial } };
    });
  }, []);

  const ensureOpen = useCallback(
    (path: string) => {
      if (loadingRef.current.has(path)) return;
      setDocs((prev) => {
        if (prev[path]) return prev;
        return {
          ...prev,
          [path]: {
            path,
            content: "",
            baseVersion: 0,
            dirty: false,
            readonly: false,
            loading: true,
          },
        };
      });
      loadingRef.current.add(path);
      void readFile(path)
        .then((file) =>
          patch(path, {
            content: file.content,
            baseVersion: file.version,
            readonly: file.readonly,
            dirty: false,
            loading: false,
            error: undefined,
          }),
        )
        .catch((err) =>
          patch(path, { loading: false, error: String(err) }),
        )
        .finally(() => loadingRef.current.delete(path));
    },
    [patch],
  );

  const update = useCallback(
    (path: string, content: string) => patch(path, { content, dirty: true }),
    [patch],
  );

  const save = useCallback(
    async (path: string) => {
      const doc = docsRef.current[path];
      if (!doc || doc.loading || doc.readonly) return;
      try {
        const version = await writeFile(path, doc.content);
        patch(path, { baseVersion: version, dirty: false, error: undefined });
      } catch (err) {
        patch(path, { error: String(err) });
      }
    },
    [patch],
  );

  const close = useCallback((path: string) => {
    setDocs((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const api = useMemo<DocumentsApi>(
    () => ({ docs, ensureOpen, update, save, close }),
    [docs, ensureOpen, update, save, close],
  );

  return (
    <DocumentsContext.Provider value={api}>
      {children}
    </DocumentsContext.Provider>
  );
}
