import { useWorkspace } from "../app/workspace";
import { useDocuments } from "../panels/editor/documents";
import { SYSTEM_THEME } from "../app/theme/themes";
import { useAllThemes } from "../app/theme/ThemeContext";
import { useThemeWorkshop } from "../app/theme/ThemeWorkshop";
import { DockLayout } from "../layout/DockLayout";
import { findGroupById } from "../layout/layout";
import { panelTitle, type PanelState } from "../layout/panel";
import { clearPanelState } from "../panels/panelState";

interface AppShellProps {
  backendStatus: string;
}

/**
 * The outer chrome: titlebar, the docking workspace, and the status bar.
 */
export function AppShell({ backendStatus }: AppShellProps) {
  const { session, dispatch, openFolder, openSettings } = useWorkspace();
  const docs = useDocuments();
  const themes = useAllThemes();
  const { openEditor } = useThemeWorkshop();
  const hasWorkspace = session.layout != null;
  const builtinThemes = themes.filter((t) => t.builtin);
  const customThemes = themes.filter((t) => !t.builtin);

  const activeGroup =
    session.ui.activeGroupId && session.layout
      ? findGroupById(session.layout, session.ui.activeGroupId)
      : null;
  const activePanel = activeGroup
    ? session.panels[activeGroup.activePanelId]
    : undefined;

  const isPanelModified = (panel: PanelState) =>
    panel.kind === "editor" ? (docs.docs[panel.path]?.dirty ?? false) : false;

  return (
    <div className="app-shell">
      <header className="app-titlebar">
        <div className="app-titlebar-left">
          <span className="app-title">ediater</span>
          {activePanel && (
            <span className="app-project muted">{panelTitle(activePanel)}</span>
          )}
        </div>
        <div className="app-titlebar-actions">
          <button className="btn" onClick={() => void openFolder()}>
            Open Folder…
          </button>
          {hasWorkspace && (
            <>
              <button
                className="btn"
                onClick={() =>
                  dispatch({ type: "togglePanelKind", kind: "search" })
                }
              >
                Search
              </button>
              <button
                className="btn"
                onClick={() =>
                  dispatch({ type: "togglePanelKind", kind: "terminal" })
                }
              >
                Terminal
              </button>
              <button
                className="btn"
                onClick={() => dispatch({ type: "togglePanelKind", kind: "ai" })}
              >
                AI
              </button>
            </>
          )}
          <select
            className="theme-select"
            title="Color theme"
            aria-label="Color theme"
            value={session.ui.theme}
            onChange={(e) =>
              dispatch({ type: "setTheme", theme: e.target.value })
            }
          >
            <option value={SYSTEM_THEME}>System</option>
            <optgroup label="Built-in">
              {builtinThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            {customThemes.length > 0 && (
              <optgroup label="Custom">
                {customThemes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            className="btn"
            title="Create or edit a color theme"
            onClick={() => openEditor()}
          >
            Customize…
          </button>
          <button
            className="btn"
            title="Settings (⌘,)"
            aria-label="Settings"
            onClick={() => openSettings()}
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="app-main">
        {session.layout ? (
          <DockLayout
            node={session.layout}
            panels={session.panels}
            activeGroupId={session.ui.activeGroupId}
            isPanelModified={isPanelModified}
            onResize={(splitId, sizes) =>
              dispatch({ type: "resizeSplit", splitId, sizes })
            }
            onMoveTab={(panelId, targetGroupId, index) =>
              dispatch({ type: "moveTab", panelId, targetGroupId, index })
            }
            onSplitTab={(panelId, targetGroupId, edge) =>
              dispatch({ type: "splitTab", panelId, targetGroupId, edge })
            }
            onSelectTab={(groupId, panelId) =>
              dispatch({ type: "setActiveTab", groupId, panelId })
            }
            onCloseTab={(panelId) => {
              const panel = session.panels[panelId];
              dispatch({ type: "closePanel", panelId });
              if (panel?.kind === "editor") docs.close(panel.path);
              clearPanelState(panelId);
            }}
            onFocusGroup={(groupId) =>
              dispatch({ type: "setActiveGroup", groupId })
            }
          />
        ) : (
          <div className="app-empty">
            <p>No folder open.</p>
            <button className="btn" onClick={() => void openFolder()}>
              Open Folder…
            </button>
          </div>
        )}
      </main>

      <footer className="app-statusbar">
        <span className="muted">backend: {backendStatus}</span>
        <span className="muted">⌘⇧P for commands</span>
      </footer>
    </div>
  );
}
