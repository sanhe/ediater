/** A runnable command surfaced in the command palette and/or via a keybinding. */
export interface Command {
  id: string;
  title: string;
  category?: string;
  /** Canonical keybinding string, e.g. "Mod+Shift+f" (Mod = Cmd/Ctrl). */
  keybinding?: string;
  run: () => void;
}
