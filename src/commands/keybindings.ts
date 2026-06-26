import { useEffect, useRef } from "react";
import type { Command } from "./types";

/** Canonical combo string for a keyboard event, e.g. "Mod+Shift+f". */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("+");
}

const PALETTE_COMBO = "Mod+Shift+p";

/**
 * Global keybinding dispatcher. Mod+Shift+P opens the palette; other combos run
 * the matching command. Editor-local shortcuts (e.g. Mod+S inside CodeMirror)
 * are handled by the editor itself and intentionally not bound here.
 */
export function useGlobalKeybindings(
  commands: Command[],
  openPalette: () => void,
) {
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = normalizeKeyEvent(e);
      if (combo === PALETTE_COMBO) {
        e.preventDefault();
        openPalette();
        return;
      }
      const cmd = commandsRef.current.find(
        (c) => c.keybinding && c.keybinding.toLowerCase() === combo.toLowerCase(),
      );
      if (cmd) {
        e.preventDefault();
        cmd.run();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openPalette]);
}

/** Render a keybinding as platform symbols for display. */
export function prettyKey(combo: string): string {
  return combo
    .replace("Mod", "⌘")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .split("+")
    .join(" ");
}
