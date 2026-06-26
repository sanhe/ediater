import { useCallback, useState } from "react";
import { useCommands } from "./useCommands";
import { useGlobalKeybindings } from "./keybindings";
import { CommandPalette } from "./CommandPalette";

/**
 * Wires global keybindings and renders the command palette overlay. Mounted
 * inside the workspace/documents providers so commands can act on live state.
 */
export function CommandsLayer() {
  const commands = useCommands();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useGlobalKeybindings(commands, openPalette);

  if (!paletteOpen) return null;
  return (
    <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
  );
}
