import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Command } from "./types";
import { fuzzyFilter } from "./fuzzy";
import { prettyKey } from "./keybindings";
import { log } from "../app/log/actionLog";
import "./commands.css";

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () =>
      fuzzyFilter(commands, query, (c) =>
        c.category ? `${c.category}: ${c.title}` : c.title,
      ),
    [commands, query],
  );

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // Keep the active item in view.
  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    log.setNextCommandSource("palette");
    cmd.run();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" ref={listRef}>
          {results.map((c, i) => (
            <li
              key={c.id}
              className={`palette-item${i === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="palette-item-title">{c.title}</span>
              {c.category && (
                <span className="palette-item-cat muted">{c.category}</span>
              )}
              {c.keybinding && (
                <span className="palette-item-key muted">
                  {prettyKey(c.keybinding)}
                </span>
              )}
            </li>
          ))}
          {results.length === 0 && (
            <li className="palette-empty muted">No matching commands</li>
          )}
        </ul>
      </div>
    </div>
  );
}
