import { useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import type { PanelBodyProps } from "../../layout/panelRegistry";
import { usePanelState } from "../panelState";
import {
  aiAction,
  aiCancel,
  type AiStreamEvent,
} from "../../app/ipc/commands";
import "./ai.css";

interface Message {
  role: "user" | "assistant";
  text: string;
}

function appendToLast(messages: Message[], delta: string): Message[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, text: last.text + delta }];
}

/**
 * AI chat panel: streams a Claude plugin's response token-by-token. The plugin
 * (an out-of-core process) handles the actual model call; this panel just sends
 * the prompt and renders the stream.
 */
export function AiPanel({ panel }: PanelBodyProps) {
  const [messages, setMessages] = usePanelState<Message[]>(
    `${panel.id}:messages`,
    [],
  );
  const [input, setInput] = usePanelState(`${panel.id}:input`, "");
  const [running, setRunning] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const finish = () => {
    setRunning(false);
    requestIdRef.current = null;
  };

  const send = () => {
    const prompt = input.trim();
    if (!prompt || running) return;
    setInput("");
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    requestIdRef.current = requestId;
    setMessages((m) => [
      ...m,
      { role: "user", text: prompt },
      { role: "assistant", text: "" },
    ]);
    setRunning(true);

    const channel = new Channel<AiStreamEvent>();
    channel.onmessage = (ev) => {
      if (ev.kind === "token") {
        setMessages((m) => appendToLast(m, ev.delta));
      } else if (ev.kind === "done") {
        finish();
      } else if (ev.kind === "error") {
        setMessages((m) => appendToLast(m, `\n[error: ${ev.message}]`));
        finish();
      }
    };

    void aiAction("claude.chat", requestId, prompt, {}, channel).catch((err) => {
      setMessages((m) => appendToLast(m, `\n[error: ${String(err)}]`));
      finish();
    });
  };

  const stop = () => {
    if (requestIdRef.current) void aiCancel(requestIdRef.current);
    finish();
  };

  return (
    <div className="ai-panel">
      <div className="ai-transcript">
        {messages.length === 0 ? (
          <div className="ai-empty muted">Ask Claude anything.</div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`ai-msg ai-${msg.role}`}>
              <div className="ai-role muted">
                {msg.role === "user" ? "You" : "Claude"}
              </div>
              <div className="ai-text">
                {msg.text ||
                  (running && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="ai-input-row">
        <textarea
          className="ai-input"
          placeholder="Message Claude…  (⌘/Ctrl+Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
        />
        {running ? (
          <button className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={send}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
