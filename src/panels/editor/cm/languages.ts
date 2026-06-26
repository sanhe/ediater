import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/**
 * Resolve a CodeMirror language for a file by its name and lazy-load it. The
 * language packages are code-split, so only grammars actually opened are
 * fetched — keeping the base bundle small. Returns null for unknown types.
 *
 * (Arbitrary TextMate grammars contributed by plugins are layered on top via
 * the Shiki bridge in a later milestone.)
 */
export async function resolveLanguage(
  path: string,
): Promise<LanguageSupport | null> {
  const filename = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const desc = LanguageDescription.matchFilename(languages, filename);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}
