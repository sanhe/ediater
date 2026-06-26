import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { resolveLanguage } from "./cm/languages";
import type { ThemeKind } from "../../app/theme/themes";

interface CodeMirrorViewProps {
  path: string;
  initialContent: string;
  readonly: boolean;
  /** Base appearance of the active theme; selects the syntax palette. */
  kind: ThemeKind;
  onChange: (content: string) => void;
  onSave: () => void;
}

/**
 * Editor chrome (background, gutters, selection, cursor) driven by the active
 * theme's CSS variables, so every theme — not just the canonical dark/light —
 * gets a matching editor. Syntax token colours come from the kind-specific
 * highlight palette layered underneath (`oneDark` for dark, CM's default for
 * light), reconfigured live via the theme compartment.
 */
const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--editor-bg)",
    color: "var(--editor-fg)",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--editor-gutter-fg)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--editor-active-line)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--editor-cursor)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--editor-selection)",
  },
});

const syntaxFor = (kind: ThemeKind) => (kind === "dark" ? oneDark : []);

/**
 * A single CodeMirror 6 editor instance bound to one file. The parent keys this
 * component by path, so switching/opening a file mounts a fresh view with that
 * file's content; theme changes reconfigure in place via a compartment.
 */
export function CodeMirrorView({
  path,
  initialContent,
  readonly,
  kind,
  onChange,
  onSave,
}: CodeMirrorViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());

  // Keep latest callbacks in refs so the view (built once) never goes stale.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        themeCompartment.current.of(syntaxFor(kind)),
        languageCompartment.current.of([]),
        EditorState.readOnly.of(readonly),
        Prec.highest(
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        // Chrome last so it overrides the syntax palette's editor styling.
        editorChrome,
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    let cancelled = false;
    void resolveLanguage(path).then((support) => {
      if (!cancelled && support && viewRef.current) {
        viewRef.current.dispatch({
          effects: languageCompartment.current.reconfigure(support),
        });
      }
    });

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mounted path; parent remounts on path change.
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(syntaxFor(kind)),
    });
  }, [kind]);

  return <div className="cm-host" ref={hostRef} />;
}
