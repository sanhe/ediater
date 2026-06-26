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
  let buffer = Buffer.alloc(0);

  function send(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }
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
    start() {
      process.stdin.on("data", onData);
      process.stdin.resume();
    },
  };
}
