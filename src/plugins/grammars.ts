/**
 * Frontend registry of plugin-contributed grammars. On startup we fetch the
 * grammars from the host, register each with the TextMate→CodeMirror bridge,
 * and keep a synchronous extension→languageId map the editor consults.
 */
import { pluginsGetGrammars } from "../app/ipc/commands";
import { registerGrammar } from "../panels/editor/cm/textmate";

const extToLanguage = new Map<string, string>();
let loaded = false;

/** The plugin grammar language id for a path, or null. */
export function grammarLanguageForPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return extToLanguage.get(name.slice(dot).toLowerCase()) ?? null;
}

/** Fetch and register all plugin grammars (idempotent). */
export async function loadPluginGrammars(): Promise<void> {
  if (loaded) return;
  loaded = true;
  let grammars;
  try {
    grammars = await pluginsGetGrammars();
  } catch (err) {
    console.error("failed to load plugin grammars", err);
    return;
  }
  for (const g of grammars) {
    for (const ext of g.extensions) {
      extToLanguage.set(ext.toLowerCase(), g.languageId);
    }
    void registerGrammar(g.languageId, g.scopeName, g.grammar);
  }
}
