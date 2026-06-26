import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ping, loadSession, pickFolder, watchPaths } from "./ipc/commands";
import { defaultSession, migrateSession } from "./session/sessionData";
import { sessionReducer } from "./session/reducer";
import {
  createDebouncedPersister,
  type SessionPersister,
} from "./session/persistence";
import { WorkspaceProvider, type WorkspaceContextValue } from "./workspace";
import { DocumentsProvider } from "../panels/editor/documents";
import { CommandsLayer } from "../commands/CommandsLayer";
import { AppShell } from "../components/AppShell";

/**
 * Application hub. Owns the SessionData, wires backend IPC, drives persistence,
 * and exposes workspace actions to panels via context.
 */
export function App() {
  const [session, dispatch] = useReducer(
    sessionReducer,
    undefined,
    defaultSession,
  );
  const [hydrated, setHydrated] = useState(false);
  const [backendStatus, setBackendStatus] = useState("connecting…");
  const persisterRef = useRef<SessionPersister>(createDebouncedPersister());

  // On mount: restore the persisted session and ping the backend.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const raw = await loadSession();
        if (!cancelled && raw != null) {
          dispatch({ type: "hydrate", session: migrateSession(raw) });
        }
      } catch (err) {
        console.error("Failed to load session", err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    void (async () => {
      try {
        const pong = await ping();
        if (!cancelled) setBackendStatus(pong);
      } catch (err) {
        if (!cancelled) setBackendStatus(`error: ${String(err)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The set of open project folders (explorer tabs) drives file watching.
  const explorerRoots = useMemo(() => {
    const roots = Object.values(session.panels)
      .filter((p) => p.kind === "explorer")
      .map((p) => p.root);
    return Array.from(new Set(roots));
  }, [session.panels]);

  // Re-arm watchers whenever the set of open folders changes.
  useEffect(() => {
    if (hydrated) {
      void watchPaths(explorerRoots).catch((err) =>
        console.error("watchPaths failed", err),
      );
    }
  }, [hydrated, explorerRoots]);

  // Persist whenever the session changes (but not before initial hydration).
  useEffect(() => {
    if (hydrated) {
      persisterRef.current.schedule(session);
    }
  }, [session, hydrated]);

  // Flush any pending save before the window unloads.
  useEffect(() => {
    const persister = persisterRef.current;
    const onBeforeUnload = () => persister.flushNow();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Reflect the theme on the document root so CSS variables switch.
  useEffect(() => {
    document.documentElement.dataset.theme = session.ui.theme;
  }, [session.ui.theme]);

  const openFolder = useCallback(async () => {
    const root = await pickFolder();
    if (root) {
      dispatch({ type: "openFolderTab", root });
    }
  }, []);

  const openFile = useCallback((path: string) => {
    dispatch({ type: "openFileTab", path });
  }, []);

  const workspace = useMemo<WorkspaceContextValue>(
    () => ({ session, dispatch, openFolder, openFile }),
    [session, openFolder, openFile],
  );

  return (
    <WorkspaceProvider value={workspace}>
      <DocumentsProvider>
        <AppShell backendStatus={backendStatus} />
        <CommandsLayer />
      </DocumentsProvider>
    </WorkspaceProvider>
  );
}
