import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { homeDir } from "@tauri-apps/api/path";
import { ping, loadSession, pickFolder, watchPaths } from "./ipc/commands";
import { onEvent } from "./ipc/events";
import { log } from "./log/actionLog";
import { defaultSession, migrateSession } from "./session/sessionData";
import { sessionReducer } from "./session/reducer";
import {
  createDebouncedPersister,
  type SessionPersister,
} from "./session/persistence";
import { WorkspaceProvider, type WorkspaceContextValue } from "./workspace";
import { ThemeController } from "./theme/ThemeContext";
import { ThemeWorkshopProvider } from "./theme/ThemeWorkshop";
import { DocumentsProvider } from "../panels/editor/documents";
import { requestReveal } from "../panels/editor/reveal";
import { loadPluginGrammars } from "../plugins/grammars";
import { CommandsLayer } from "../commands/CommandsLayer";
import { SettingsModal } from "./settings/SettingsModal";
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

  // Latest session, read synchronously by the logger to capture pre-dispatch
  // ("previous") state without re-rendering dependents.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Every workspace mutation is logged here, then applied by the pure reducer.
  // Wrapping dispatch (not the reducer) keeps the reducer pure and fires exactly
  // once under React StrictMode.
  const loggedDispatch = useCallback<typeof dispatch>((action) => {
    log.dispatch(action, sessionRef.current);
    dispatch(action);
  }, []);

  // Open the action log for this run first (so run.start leads the sequence),
  // and resolve the home dir so "full" path scope can collapse it to "~".
  useEffect(() => {
    log.runStart({
      theme: sessionRef.current.ui.theme,
      platform: navigator?.platform ?? "unknown",
    });
    void homeDir()
      .then((home) => log.setHome(home))
      .catch(() => undefined);
  }, []);

  // On mount: restore the persisted session and ping the backend.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const raw = await loadSession();
        if (!cancelled && raw != null) {
          loggedDispatch({ type: "hydrate", session: migrateSession(raw) });
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
  }, [loggedDispatch]);

  // The set of open project folders (explorer tabs) drives file watching.
  const explorerRoots = useMemo(() => {
    const roots = Object.values(session.panels)
      .filter((p) => p.kind === "explorer")
      .map((p) => p.root);
    return Array.from(new Set(roots));
  }, [session.panels]);

  // Re-arm watchers whenever the set of open folders changes.
  useEffect(() => {
    log.setRoots(explorerRoots);
    if (hydrated) {
      void watchPaths(explorerRoots).catch((err) =>
        console.error("watchPaths failed", err),
      );
    }
  }, [hydrated, explorerRoots]);

  // Log filesystem changes reported by the backend watcher. This is a separate
  // subscription from the explorer's own refresh listener.
  useEffect(() => {
    const unlisten = onEvent<{ paths: string[] }>(
      "fs-changed",
      ({ payload }) => log.fsChanged(payload.paths),
    );
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  // Persist whenever the session changes (but not before initial hydration).
  useEffect(() => {
    if (hydrated) {
      persisterRef.current.schedule(session);
    }
  }, [session, hydrated]);

  // Flush any pending save and close the action log before the window unloads.
  useEffect(() => {
    const persister = persisterRef.current;
    const onBeforeUnload = () => {
      persister.flushNow();
      log.runEnd();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Register plugin-contributed grammars with the editor highlighter.
  useEffect(() => {
    void loadPluginGrammars();
  }, []);

  const openFolder = useCallback(async () => {
    const root = await pickFolder();
    if (root) {
      loggedDispatch({ type: "openFolderTab", root });
    }
  }, [loggedDispatch]);

  const openFile = useCallback(
    (path: string, line?: number) => {
      loggedDispatch({ type: "openFileTab", path });
      if (line != null) requestReveal(path, line);
    },
    [loggedDispatch],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const workspace = useMemo<WorkspaceContextValue>(
    () => ({
      session,
      dispatch: loggedDispatch,
      openFolder,
      openFile,
      openSettings,
    }),
    [session, loggedDispatch, openFolder, openFile, openSettings],
  );

  return (
    <WorkspaceProvider value={workspace}>
      <ThemeController
        preference={session.ui.theme}
        customThemes={session.ui.customThemes}
      >
        <ThemeWorkshopProvider>
          <DocumentsProvider>
            <AppShell backendStatus={backendStatus} />
            <CommandsLayer />
            {settingsOpen && (
              <SettingsModal onClose={() => setSettingsOpen(false)} />
            )}
          </DocumentsProvider>
        </ThemeWorkshopProvider>
      </ThemeController>
    </WorkspaceProvider>
  );
}
