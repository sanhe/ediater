/**
 * Reading and writing theme files. Import accepts a single theme, a bare array,
 * or a `{ themes: [...] }` pack — the shape a theme repository would publish —
 * so "upload a theme" and "install a theme pack" are the same code path. The
 * native dialogs come from the dialog plugin; file bytes go through the existing
 * `read_file`/`write_file` backend commands (which accept arbitrary paths).
 */

import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "../ipc/commands";
import { parseThemeImport, serializableTheme, type Theme } from "./themes";

const THEME_FILTERS = [{ name: "Theme", extensions: ["json"] }];

/**
 * Prompt for a `.json` theme file and return the valid themes it contains.
 * Resolves to `[]` if the user cancels; throws with a user-facing message when
 * the file can't be read/parsed or holds no valid theme.
 */
export async function importThemesFromFile(
  existingIds: string[] = [],
): Promise<Theme[]> {
  const picked = await openDialog({ multiple: false, filters: THEME_FILTERS });
  const path = typeof picked === "string" ? picked : null;
  if (!path) return [];

  const file = await readFile(path);
  let json: unknown;
  try {
    json = JSON.parse(file.content);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  const themes = parseThemeImport(json, existingIds);
  if (themes.length === 0) {
    throw new Error("No valid themes found in that file.");
  }
  return themes;
}

/**
 * Prompt for a destination and write `theme` as JSON. Returns false if the user
 * cancels the save dialog.
 */
export async function exportThemeToFile(theme: Theme): Promise<boolean> {
  const path = await saveDialog({
    defaultPath: `${theme.id}.json`,
    filters: THEME_FILTERS,
  });
  if (!path) return false;

  const body = JSON.stringify(serializableTheme(theme), null, 2);
  await writeFile(path, body);
  return true;
}
