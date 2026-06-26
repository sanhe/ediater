import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace";
import { useCommands } from "../../commands/useCommands";
import { normalizeKeyEvent, prettyKey } from "../../commands/keybindings";
import type { Settings } from "../settings";
import "./settings.css";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

/** Settings dialog: editor preferences, files, and keybinding overrides. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { session, dispatch } = useWorkspace();
  const settings = session.settings;
  const commands = useCommands();
  const [recording, setRecording] = useState<string | null>(null);
  // Number fields are edited as free text and committed (clamped) on blur, so
  // typing a multi-digit value isn't clamped mid-keystroke.
  const [fontSizeStr, setFontSizeStr] = useState(String(settings.editor.fontSize));
  const [tabSizeStr, setTabSizeStr] = useState(String(settings.editor.tabSize));

  const update = (next: Settings) =>
    dispatch({ type: "updateSettings", settings: next });
  const setEditor = (patch: Partial<Settings["editor"]>) =>
    update({ ...settings, editor: { ...settings.editor, ...patch } });
  const commitNumber = (
    raw: string,
    min: number,
    max: number,
    fallback: number,
    apply: (n: number) => void,
    setStr: (s: string) => void,
  ) => {
    const n = clamp(Math.round(Number(raw)), min, max);
    const value = Number.isFinite(n) ? n : fallback;
    apply(value);
    setStr(String(value));
  };
  const setFiles = (patch: Partial<Settings["files"]>) =>
    update({ ...settings, files: { ...settings.files, ...patch } });
  const setKeybinding = (id: string, combo: string | null) => {
    const keybindings = { ...settings.keybindings };
    if (combo) keybindings[id] = combo;
    else delete keybindings[id];
    update({ ...settings, keybindings });
  };

  // While recording, capture the next non-modifier chord for the command.
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;
      setKeybinding(recording, normalizeKeyEvent(e));
      setRecording(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, settings]);

  // Esc closes the dialog (when not recording a chord).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !recording) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recording, onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>Editor</h3>
            <label className="settings-row">
              <span>Font size</span>
              <input
                type="number"
                min={8}
                max={32}
                value={fontSizeStr}
                onChange={(e) => setFontSizeStr(e.target.value)}
                onBlur={() =>
                  commitNumber(
                    fontSizeStr,
                    8,
                    32,
                    settings.editor.fontSize,
                    (n) => setEditor({ fontSize: n }),
                    setFontSizeStr,
                  )
                }
              />
            </label>
            <label className="settings-row">
              <span>Tab size</span>
              <input
                type="number"
                min={1}
                max={8}
                value={tabSizeStr}
                onChange={(e) => setTabSizeStr(e.target.value)}
                onBlur={() =>
                  commitNumber(
                    tabSizeStr,
                    1,
                    8,
                    settings.editor.tabSize,
                    (n) => setEditor({ tabSize: n }),
                    setTabSizeStr,
                  )
                }
              />
            </label>
            <label className="settings-row">
              <span>Format on save</span>
              <input
                type="checkbox"
                checked={settings.editor.formatOnSave}
                onChange={(e) => setEditor({ formatOnSave: e.target.checked })}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Files</h3>
            <label className="settings-row">
              <span>Show hidden files</span>
              <input
                type="checkbox"
                checked={settings.files.showHidden}
                onChange={(e) => setFiles({ showHidden: e.target.checked })}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Keybindings</h3>
            <div className="settings-keys">
              {commands.map((c) => (
                <div className="settings-key-row" key={c.id}>
                  <span className="settings-key-title">
                    {c.category ? `${c.category}: ` : ""}
                    {c.title}
                  </span>
                  <span className="settings-key-combo">
                    {c.keybinding ? prettyKey(c.keybinding) : "—"}
                  </span>
                  <button
                    className="btn"
                    onClick={() => setRecording(c.id)}
                  >
                    {recording === c.id ? "Press keys…" : "Edit"}
                  </button>
                  {settings.keybindings[c.id] && (
                    <button
                      className="btn"
                      onClick={() => setKeybinding(c.id, null)}
                    >
                      Reset
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
