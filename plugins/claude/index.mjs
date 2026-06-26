// Sample ediater AI plugin: streaming chat with Claude.
//
// Runs as `node index.mjs`, spawned by the host. With ANTHROPIC_API_KEY set it
// streams from the real Anthropic Messages API (SSE); otherwise it streams a
// canned reply so the pipeline is demoable without a key or network.
import { createPlugin } from "../sdk/ediater-plugin-sdk.mjs";

const plugin = createPlugin();
const MODEL = process.env.EDIATER_CLAUDE_MODEL || "claude-opus-4-8";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

plugin.onAiAction("claude.chat", async (ctx) => {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? streamAnthropic(key, ctx) : streamMock(ctx);
});

async function streamMock(ctx) {
  const reply =
    `Claude (mock mode): you said "${ctx.prompt}". ` +
    `Set ANTHROPIC_API_KEY in the plugin's environment for real responses.`;
  let out = "";
  for (const chunk of reply.split(/(\s+)/)) {
    if (ctx.cancelled) break;
    ctx.token(chunk);
    out += chunk;
    await sleep(25);
  }
  return out;
}

async function streamAnthropic(key, ctx) {
  ctx.status("thinking");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: ctx.prompt }],
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    if (ctx.cancelled) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        ctx.token(evt.delta.text);
        full += evt.delta.text;
      }
    }
  }
  return full;
}

plugin.start();
