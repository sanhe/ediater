import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { resolveLanguage } from "./cm/languages";
import { textmateHighlighter } from "./cm/textmate";
import { onReveal, onSetText } from "./reveal";
import { grammarLanguageForPath } from "../../plugins/grammars";
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
  const textmateCompartment = useRef(new Compartment());
  // A plugin-contributed TextMate grammar for this file, if any.
  const tmLang = useRef<string | null>(grammarLanguageForPath(path));

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
        textmateCompartment.current.of(
          tmLang.current ? textmateHighlighter(tmLang.current) : [],
        ),
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

    // Plugin grammars provide highlighting; otherwise use CodeMirror's own
    // language for both editing behavior and highlighting.
    let cancelled = false;
    if (!tmLang.current) {
      void resolveLanguage(path).then((support) => {
        if (!cancelled && support && viewRef.current) {
          viewRef.current.dispatch({
            effects: languageCompartment.current.reconfigure(support),
          });
        }
      });
    }

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mounted path; parent remounts on path change.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(syntaxFor(kind)),
    });
    // Rebuild TextMate decorations with the new theme's colors.
    if (tmLang.current) {
      view.dispatch({
        effects: textmateCompartment.current.reconfigure(
          textmateHighlighter(tmLang.current),
        ),
      });
    }
  }, [kind]);

  // Reveal a line on request (e.g. clicking a search result).
  useEffect(() => {
    return onReveal(path, ({ line, column }) => {
      const view = viewRef.current;
      if (!view) return;
      const lineNo = Math.max(1, Math.min(line, view.state.doc.lines));
      const lineInfo = view.state.doc.line(lineNo);
      const pos =
        column != null
          ? Math.min(lineInfo.from + column, lineInfo.to)
          : lineInfo.from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      view.focus();
    });
  }, [path]);

  // Replace content on request (e.g. applying a formatter's output).
  useEffect(() => {
    return onSetText(path, (text) => {
      const view = viewRef.current;
      if (!view || text === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: "format",
      });
    });
  }, [path]);

  return <div className="cm-host" ref={hostRef} />;
}
