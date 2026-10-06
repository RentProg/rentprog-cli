// testkit/fake-server.js
import http from "node:http";
import { after } from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// tools: [{name, description, inputSchema, annotations}]
// handler(name, args, call#) вызывается ОДИН раз на tools/call (у журнала в тестах записи есть состояние) и
// возвращает CallToolResult, или {http: 429, headers, body} — ответ HTTP без MCP, или {destroy: true} — обрыв сокета;
// обработчик может ждать (await) — так моделируется таймаут.
// Every server is closed after the test file even when a test fails midway — otherwise an open socket keeps the
// runner alive (and --test-force-exit loses results on Node 20).
const open = new Set();
after(async () => { await Promise.all([...open].map((s) => s.close())); });

export async function startFakeServer({ tools, handler, key = "rpa_test0001", host = "127.0.0.1", onList = () => {} }) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${key}`) {
      res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "unknown_token" } })); return;
    }
    const body = await new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b ? JSON.parse(b) : undefined)); });
    let result;
    if (body?.method === "tools/call") {
      calls.push(body.params);
      result = await handler(body.params.name, body.params.arguments ?? {}, calls.length);
      if (result?.http) { res.writeHead(result.http, { "content-type": "application/json", ...(result.headers ?? {}) }); res.end(JSON.stringify(result.body ?? {})); return; }
      if (result?.destroy) { req.socket.destroy(); return; }
    }
    const mcp = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => { onList(); return { tools }; });
    mcp.setRequestHandler(CallToolRequestSchema, async () => result);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise((r) => server.listen(0, host, r));
  const handle = { url: `http://${host}:${server.address().port}/mcp`, key, calls,
    close: () => { open.delete(handle); return new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }); } };
  open.add(handle);
  return handle;
}
