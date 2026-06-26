/**
 * TextMate-grammar highlighting bridge for CodeMirror 6, backed by Shiki.
 *
 * CodeMirror has no native TextMate consumer, so plugin-contributed grammars
 * are tokenized with Shiki (which carries the oniguruma engine) and the tokens
 * are emitted as CodeMirror mark decorations with inline colors from a Shiki
 * theme. Shiki is lazy-loaded (fine-grained) the first time a grammar is needed,
 * so the base bundle stays small.
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { HighlighterCore } from "shiki/core";

const MAX_CHARS = 300_000;

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;
const registered = new Set<string>();
const readyCallbacks = new Set<() => void>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/oniguruma"),
      import("shiki/themes/github-dark.mjs"),
      import("shiki/themes/github-light.mjs"),
      import("shiki/wasm"),
    ])
      .then(([core, oniguruma, dark, light, wasm]) =>
        core.createHighlighterCore({
          themes: [dark.default, light.default],
          langs: [],
          engine: oniguruma.createOnigurumaEngine(wasm),
        }),
      )
      .then((hl) => {
        highlighter = hl;
        return hl;
      });
  }
  return highlighterPromise;
}

export async function registerGrammar(
  languageId: string,
  scopeName: string,
  grammar: unknown,
): Promise<void> {
  if (registered.has(languageId)) return;
  const hl = await getHighlighter();
  try {
    await hl.loadLanguage({
      ...(grammar as Record<string, unknown>),
      name: languageId,
      scopeName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    registered.add(languageId);
    readyCallbacks.forEach((cb) => cb());
  } catch (e) {
    console.error(`failed to load grammar ${languageId}`, e);
  }
}

function themeName(): string {
  return document.documentElement.dataset.themeKind === "light"
    ? "github-light"
    : "github-dark";
}

function buildDecorations(view: EditorView, languageId: string): DecorationSet {
  if (!highlighter || !registered.has(languageId)) return Decoration.none;
  const doc = view.state.doc;
  if (doc.length > MAX_CHARS) return Decoration.none;

  let result;
  try {
    result = highlighter.codeToTokens(doc.toString(), {
      lang: languageId,
      theme: themeName(),
    });
  } catch {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const lineCount = doc.lines;
  for (let i = 0; i < result.tokens.length && i < lineCount; i++) {
    const line = doc.line(i + 1);
    let col = 0;
    for (const token of result.tokens[i]) {
      const len = token.content.length;
      if (len > 0 && token.color && token.content.trim() !== "") {
        const from = line.from + col;
        const to = from + len;
        if (to <= line.to) {
          builder.add(
            from,
            to,
            Decoration.mark({ attributes: { style: `color:${token.color}` } }),
          );
        }
      }
      col += len;
    }
  }
  return builder.finish();
}

/** A CodeMirror extension that highlights using a registered plugin grammar. */
export function textmateHighlighter(languageId: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      onReady: () => void;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, languageId);
        this.onReady = () => {
          this.decorations = buildDecorations(view, languageId);
          view.dispatch({}); // nudge CM to re-read decorations
        };
        if (!highlighter || !registered.has(languageId)) {
          readyCallbacks.add(this.onReady);
          void getHighlighter();
        }
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, languageId);
        }
      }

      destroy() {
        readyCallbacks.delete(this.onReady);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
