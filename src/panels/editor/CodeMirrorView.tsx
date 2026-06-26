import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { resolveLanguage } from "./cm/languages";
import type { ThemeMode } from "../../app/session/sessionData";

interface CodeMirrorViewProps {
  path: string;
  initialContent: string;
  readonly: boolean;
  theme: ThemeMode;
  onChange: (content: string) => void;
  onSave: () => void;
}

/**
 * A single CodeMirror 6 editor instance bound to one file. The parent keys this
 * component by path, so switching/opening a file mounts a fresh view with that
 * file's content; theme changes reconfigure in place via a compartment.
 */
export function CodeMirrorView({
  path,
  initialContent,
  readonly,
  theme,
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
        themeCompartment.current.of(theme === "dark" ? oneDark : []),
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
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
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
      effects: themeCompartment.current.reconfigure(
        theme === "dark" ? oneDark : [],
      ),
    });
  }, [theme]);

  return <div className="cm-host" ref={hostRef} />;
}
