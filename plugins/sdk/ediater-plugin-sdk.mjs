// Minimal ediater plugin SDK (Node, no dependencies).
//
// Implements the host↔plugin transport so authors only write capability
// handlers: JSON-RPC 2.0 over stdio with Content-Length framing, plus the
// initialize/initialized/shutdown/exit lifecycle.
//
//   import { createPlugin } from "../sdk/ediater-plugin-sdk.mjs";
//   const plugin = createPlugin();
//   plugin.onFormat("json", (text, params) => formatted);
//   plugin.start();

export function createPlugin() {
  const formatters = new Map(); // languageId -> (text, params) => string
  const commands = new Map(); // commandId -> (params) => any
  const aiActions = new Map(); // actionId -> (ctx) => string | void
  const cancelled = new Set(); // requestIds cancelled by the host
  let buffer = Buffer.alloc(0);

  function send(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const replyError = (id, message) =>
    send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

  async function handle(msg) {
    const { id, method, params } = msg ?? {};
    switch (method) {
      case "initialize":
        reply(id, {
          serverInfo: { name: "ediater-plugin" },
          capabilities: {
            formatting: [...formatters.keys()],
            commands: [...commands.keys()],
            aiActions: [...aiActions.keys()],
          },
        });
        return;
      case "initialized":
        return; // notification
      case "shutdown":
        reply(id, null);
        return;
      case "exit":
        process.exit(0);
        return;
      case "format": {
        const handler = formatters.get(params?.languageId);
        if (!handler) {
          replyError(id, `no formatter for ${params?.languageId}`);
          return;
        }
        try {
          const text = await handler(params?.text ?? "", params ?? {});
          reply(id, { text });
        } catch (e) {
          replyError(id, String(e?.message ?? e));
        }
        return;
      }
      case "command/execute": {
        const handler = commands.get(params?.commandId);
        if (!handler) {
          replyError(id, `no command ${params?.commandId}`);
          return;
        }
        try {
          reply(id, (await handler(params?.args ?? {})) ?? null);
        } catch (e) {
          replyError(id, String(e?.message ?? e));
        }
        return;
      }
      case "ai/action": {
        const { actionId, requestId, prompt, context } = params ?? {};
        const handler = aiActions.get(actionId);
        if (!handler) {
          notify("ai/stream", {
            requestId,
            kind: "error",
            message: `no ai action ${actionId}`,
          });
          return;
        }
        const ctx = {
          prompt,
          context,
          requestId,
          get cancelled() {
            return cancelled.has(requestId);
          },
          token: (delta) => notify("ai/stream", { requestId, kind: "token", delta }),
          status: (status) =>
            notify("ai/stream", { requestId, kind: "status", status }),
        };
        Promise.resolve(handler(ctx))
          .then((text) => {
            if (!cancelled.has(requestId)) {
              notify("ai/stream", {
                requestId,
                kind: "done",
                text: typeof text === "string" ? text : undefined,
              });
            }
            cancelled.delete(requestId);
          })
          .catch((e) => {
            notify("ai/stream", {
              requestId,
              kind: "error",
              message: String(e?.message ?? e),
            });
            cancelled.delete(requestId);
          });
        return; // notification — no reply
      }
      case "ai/cancel":
        if (params?.requestId != null) cancelled.add(params.requestId);
        return;
      default:
        if (id != null) replyError(id, `unknown method ${method}`);
    }
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const start = headerEnd + 4;
      if (!match) {
        buffer = buffer.slice(start);
        continue;
      }
      const len = parseInt(match[1], 10);
      if (buffer.length < start + len) break; // wait for the rest
      const body = buffer.slice(start, start + len).toString("utf8");
      buffer = buffer.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      Promise.resolve(handle(msg)).catch(() => {});
    }
  }

  return {
    onFormat(languageId, handler) {
      formatters.set(languageId, handler);
      return this;
    },
    onCommand(commandId, handler) {
      commands.set(commandId, handler);
      return this;
    },
    onAiAction(actionId, handler) {
      aiActions.set(actionId, handler);
      return this;
    },
    start() {
      process.stdin.on("data", onData);
      process.stdin.resume();
    },
  };
}
