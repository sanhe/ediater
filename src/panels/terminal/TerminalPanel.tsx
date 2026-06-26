import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import {
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "../../app/ipc/commands";
import { onEvent } from "../../app/ipc/events";
import { useWorkspace } from "../../app/workspace";
import { useResolvedTheme } from "../../app/theme/ThemeContext";
import type { Theme } from "../../app/theme/themes";
import "./terminal.css";

function xtermTheme(theme: Theme) {
  const c = theme.colors;
  return {
    background: c.editorBg,
    foreground: c.editorFg,
    cursor: c.editorCursor,
    cursorAccent: c.editorBg,
    selectionBackground: c.editorSelection,
  };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * An xterm.js terminal bound to a backend PTY. Spawns a shell on mount (rooted
 * at the first open folder), streams output via a Tauri channel, forwards input
 * and resize, and kills the PTY on unmount. Hidden by default — created only
 * when a Terminal tab exists.
 */
export function TerminalPanel() {
  const { session } = useWorkspace();
  const resolved = useResolvedTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  // Resolve the working directory once (first open folder, else shell default).
  const cwdRef = useRef<string | undefined>(undefined);
  if (cwdRef.current === undefined) {
    const explorer = Object.values(session.panels).find(
      (p) => p.kind === "explorer",
    );
    cwdRef.current = explorer && explorer.kind === "explorer" ? explorer.root : "";
  }
  const themeRef = useRef(resolved);
  themeRef.current = resolved;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let ptyId: string | null = null;

    const term = new Terminal({
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: xtermTheme(themeRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not measurable yet */
    }
    termRef.current = term;

    const channel = new Channel<string>();
    channel.onmessage = (b64) => term.write(b64ToBytes(b64));

    void (async () => {
      try {
        const id = await ptySpawn({
          cwd: cwdRef.current || undefined,
          cols: term.cols,
          rows: term.rows,
          onData: channel,
        });
        if (disposed) {
          void ptyKill(id);
          return;
        }
        ptyId = id;
        term.onData((d) => void ptyWrite(id, d));
      } catch (err) {
        term.write(`\r\n\x1b[31mfailed to start terminal: ${String(err)}\x1b[0m\r\n`);
      }
    })();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ptyId) void ptyResize(ptyId, term.cols, term.rows);
      } catch {
        /* ignore transient measure errors */
      }
    });
    ro.observe(host);

    const unlisten = onEvent<string>("pty-exit", (e) => {
      if (e.payload === ptyId) {
        term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      }
    });

    return () => {
      disposed = true;
      ro.disconnect();
      void unlisten.then((f) => f());
      if (ptyId) void ptyKill(ptyId);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Re-theme the live terminal when the resolved theme changes.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(resolved);
    }
  }, [resolved]);

  return <div className="terminal-host" ref={hostRef} />;
}
