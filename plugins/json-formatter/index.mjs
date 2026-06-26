// Sample ediater plugin: a JSON formatter. Runs as `node index.mjs`, spawned by
// the ediater plugin host, speaking JSON-RPC over stdio via the SDK.
import { createPlugin } from "../sdk/ediater-plugin-sdk.mjs";

const plugin = createPlugin();

plugin.onFormat("json", (text, params) => {
  const insertSpaces = params?.options?.insertSpaces !== false;
  const indent = insertSpaces ? (params?.options?.tabSize ?? 2) : "\t";
  // Throws on invalid JSON — the SDK turns that into a JSON-RPC error the host
  // surfaces to the user, leaving the buffer untouched.
  const parsed = JSON.parse(text);
  return JSON.stringify(parsed, null, indent) + "\n";
});

plugin.start();
