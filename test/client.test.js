// test/client.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
const freePort = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
import { startFakeServer } from "../testkit/fake-server.js";
import { connect } from "../src/client.js";

// Proxy listener closed after the test even when it fails midway (open sockets would keep the runner alive)
async function listen(t, server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return server.address().port;
}

const TOOLS = [{ name: "whoami", description: "Who owns the key", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }];

test("listTools и callTool; structuredContent без outputSchema принимается (ER-02)", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { user: { id: 1 } } }) });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  assert.equal((await c.listTools())[0].name, "whoami");
  assert.deepEqual((await c.callTool("whoami", {})).structuredContent, { user: { id: 1 } });
  await c.close(); await srv.close();
});

test("HTTP 401 → TransportError phase=http status=401", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({ content: [] }) });
  await assert.rejects(connect({ url: srv.url, key: "rpa_wrong", timeoutMs: 5000, env: {} }), (e) => e.phase === "http" && e.status === 401);
  await srv.close();
});

test("HTTP 429 → status 429 и Retry-After", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({ http: 429, headers: { "retry-after": "7" }, body: { error: { code: "rate_limited" } } }) });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  await assert.rejects(c.callTool("whoami", {}), (e) => e.status === 429 && e.retryAfter === 7);
  await c.close(); await srv.close();
});

test("соединение отвергнуто → phase=before_send; обрыв после отправки → phase=after_send", async () => {
  await assert.rejects(connect({ url: `http://127.0.0.1:${await freePort()}/mcp`, key: "rpa_x", timeoutMs: 2000, env: {} }), (e) => e.phase === "before_send");
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({ destroy: true }) });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  await assert.rejects(c.callTool("whoami", {}), (e) => e.phase === "after_send");
  await c.close(); await srv.close();
});

test("прокси окружения без NODE_USE_ENV_PROXY: запросы идут через прокси (Review Focus)", async (t) => {
  const target = await startFakeServer({ tools: TOOLS, handler: async () => ({ content: [] }) }); t.after(target.close);
  let proxied = 0;
  const proxy = http.createServer((req, res) => {
    proxied++;
    const up = http.request(req.url, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  proxy.on("connect", (req, sock, head) => {   // undici ProxyAgent туннелирует CONNECT и для http
    proxied++;
    const [h, p] = req.url.split(":");
    const up = net.connect(Number(p), h, () => { sock.write("HTTP/1.1 200 Connection Established\r\n\r\n"); up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
  });
  const env = { HTTP_PROXY: `http://127.0.0.1:${await listen(t, proxy)}`, NO_PROXY: "" };
  const c = await connect({ url: target.url.replace("127.0.0.1", "localhost"), key: target.key, timeoutMs: 5000, env });
  t.after(() => c.close());
  await c.listTools();
  assert.ok(proxied > 0);
});

test("NO_PROXY: адрес из исключений идёт мимо прокси", async (t) => {
  const target = await startFakeServer({ tools: TOOLS, handler: async () => ({ content: [] }) }); t.after(target.close);
  let proxied = 0;
  const proxy = http.createServer((req, res) => { proxied++; res.writeHead(502); res.end(); });
  proxy.on("connect", (req, sock) => { proxied++; sock.destroy(); });
  const port = await listen(t, proxy);
  const c = await connect({ url: target.url.replace("127.0.0.1", "localhost"), key: target.key, timeoutMs: 5000, env: { HTTP_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "localhost" } });
  await c.listTools();
  assert.equal(proxied, 0);
  await c.close();
});
