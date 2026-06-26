import {
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  createCustomTheme,
  THEME_COLOR_FIELDS,
  type Theme,
  type ThemeColors,
  type ThemeColorField,
  type ThemeKind,
} from "./themes";
import "./theme-editor.css";

interface ThemeEditorProps {
  /** Palette/kind the editor opens with. */
  seed: Theme;
  /** The custom theme being edited, or null when authoring a new one. */
  editing: Theme | null;
  /** Existing custom theme ids, so a new id doesn't collide. */
  existingIds: string[];
  onSave: (theme: Theme) => void;
  onCancel: () => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Fields grouped by section, preserving first-seen order. */
function groupedFields(): [string, ThemeColorField[]][] {
  const groups = new Map<string, ThemeColorField[]>();
  for (const field of THEME_COLOR_FIELDS) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return [...groups.entries()];
}

export function ThemeEditor({
  seed,
  editing,
  existingIds,
  onSave,
  onCancel,
}: ThemeEditorProps) {
  const [label, setLabel] = useState(
    editing ? editing.label : `${seed.label} (copy)`,
  );
  const [kind, setKind] = useState<ThemeKind>(seed.kind);
  const [colors, setColors] = useState<ThemeColors>({ ...seed.colors });

  const sections = useMemo(groupedFields, []);
  const previewStyle = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const field of THEME_COLOR_FIELDS) vars[field.cssVar] = colors[field.key];
    return vars as CSSProperties;
  }, [colors]);

  const setColor = (key: keyof ThemeColors, value: string) =>
    setColors((prev) => ({ ...prev, [key]: value }));

  const canSave = label.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave(
      createCustomTheme(
        { id: editing?.id, label, kind, colors },
        existingIds,
      ),
    );
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="te-overlay" onMouseDown={onCancel}>
      <div
        className="te-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="te-header">
          <span className="te-title">
            {editing ? "Edit Theme" : "New Theme"}
          </span>
        </header>

        <div className="te-body">
          <div className="te-form">
            <label className="te-meta">
              <span className="te-meta-label">Name</span>
              <input
                className="te-text"
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="te-meta">
              <span className="te-meta-label">Base appearance</span>
              <select
                className="te-text"
                value={kind}
                onChange={(e) => setKind(e.target.value as ThemeKind)}
              >
                <option value="dark">Dark (dark syntax)</option>
                <option value="light">Light (light syntax)</option>
              </select>
            </label>

            {sections.map(([group, fields]) => (
              <fieldset className="te-group" key={group}>
                <legend>{group}</legend>
                {fields.map((field) => {
                  const value = colors[field.key];
                  return (
                    <div className="te-row" key={field.key}>
                      <span className="te-row-label">{field.label}</span>
                      {HEX.test(value) ? (
                        <input
                          type="color"
                          className="te-swatch"
                          value={value}
                          onChange={(e) => setColor(field.key, e.target.value)}
                        />
                      ) : (
                        <span
                          className="te-swatch te-swatch-static"
                          style={{ background: value }}
                          title="Edit the value to change (supports rgba/hsl)"
                        />
                      )}
                      <input
                        className="te-text te-row-value"
                        value={value}
                        spellCheck={false}
                        onChange={(e) => setColor(field.key, e.target.value)}
                      />
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>

          <div className="te-preview">
            <span className="te-preview-caption">Preview</span>
            <div className="te-preview-app" style={previewStyle}>
              <div className="te-pv-titlebar">
                <span className="te-pv-title">ediater</span>
                <span className="te-pv-chip">{label || "Untitled"}</span>
              </div>
              <div className="te-pv-main">
                <div className="te-pv-gutter">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                </div>
                <div className="te-pv-editor">
                  <div className="te-pv-line te-pv-active">
                    const <span className="te-pv-accent">theme</span> = pick();
                  </div>
                  <div className="te-pv-line">
                    <span className="te-pv-sel">// selected text</span>
                  </div>
                  <div className="te-pv-line te-pv-muted">return theme;</div>
                </div>
              </div>
              <div className="te-pv-statusbar">
                <span>preview</span>
                <span>{kind}</span>
              </div>
            </div>
          </div>
        </div>

        <footer className="te-footer">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn te-save" onClick={save} disabled={!canSave}>
            {editing ? "Save Changes" : "Create Theme"}
          </button>
        </footer>
      </div>
    </div>
  );
}
