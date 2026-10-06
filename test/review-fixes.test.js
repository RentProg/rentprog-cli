// Fixes from the STEP-11 code review (fresh agent + Codex): each test failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { startFakeServer } from "../testkit/fake-server.js";
import { harness } from "../testkit/harness.js";
import { main } from "../src/cli.js";
import { parseToolArgs } from "../src/flags.js";
import { resolveCredentials } from "../src/hosts.js";
import { ask } from "../src/tty.js";
import { connect } from "../src/client.js";
import http from "node:http";

const R = (name, props = {}) => ({ name, description: `${name}.`, inputSchema: { type: "object", properties: props }, annotations: { readOnlyHint: true } });

test("login --allow-host на чужой хост по http → 2 до запроса; https обязателен (FM-02)", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami")], handler: async () => ({ structuredContent: {} }), host: "0.0.0.0" });
  t.after(srv.close);
  let reached = 0; srv.onRequest = () => reached++;
  const h = harness({ RENTPROG_API_KEY: srv.key });
  assert.equal(await main(["login", "--url", srv.url, "--allow-host"], h.io), 2);
  assert.match(JSON.parse(h.stderr()).message, /https/);
});

test("login: на чужом хосте уходит только ключ из RENTPROG_API_KEY; без --allow-host — 2 даже с ключом окружения", async () => {
  const { loginKey } = await import("../src/cli.js");
  assert.equal(loginKey({ foreign: true, rest: ["rpa_positional"], env: { RENTPROG_API_KEY: "rpa_env" } }), "rpa_env");
  assert.equal(loginKey({ foreign: false, rest: ["rpa_positional"], env: { RENTPROG_API_KEY: "rpa_env" } }), "rpa_positional");
  const { loginSaves } = await import("../src/cli.js");
  assert.equal(loginSaves({ foreign: true }), false);   // a key checked on a foreign host is never saved
  assert.equal(loginSaves({ foreign: false }), true);
  const h = harness({ RENTPROG_API_KEY: "rpa_env" });
  assert.equal(await main(["login", "--url", "https://evil.example/mcp"], h.io), 2);
  assert.equal(existsSync(h.configFile), false);
});

test("флаги без значения не принимают =…: --yes=false, --all=1, --no-input=x, --allow-host=x, --help=x → 2", () => {
  for (const f of ["--yes=false", "--all=1", "--no-input=x", "--allow-host=x", "--help=x"])
    assert.throws(() => parseToolArgs([f], { type: "object", properties: {} }), (e) => e.code === 2, f);
});

test("сохранённый адрес вне разрешённых (правка config.json) → 2, ключ не отправляется", () => {
  assert.throws(() => resolveCredentials({ env: {}, saved: { url: "https://evil.example/mcp", key: "rpa_x" }, flags: {} }), (e) => e.code === 2);
  assert.throws(() => resolveCredentials({ env: {}, saved: { url: "http://api.rentprog.ru/mcp", key: "rpa_x" }, flags: {} }), (e) => e.code === 2);
});

test("operation_status с ошибкой internal → 4 (чтение); опрос --wait с internal → 4 и operation_id", { timeout: 15_000 }, async (t) => {
  const tools = [R("operation_status", { operation_id: { type: "integer" } }),
    { name: "pay_fine", description: "Pay.", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: { fine_id: { type: "integer" }, idempotency_key: { type: "string" } } } }];
  const internal = { isError: true, structuredContent: { error: "internal", message: "failed", details: {} } };
  const srv = await startFakeServer({ tools, handler: async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : internal) });
  t.after(srv.close);
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url, RENTPROG_WAIT_INTERVAL_MS: "20" });
  assert.equal(await main(["operation_status", "--operation-id", "9"], h.io), 4);
  h.err.length = 0;
  assert.equal(await main(["pay_fine", "--fine-id", "1", "--wait", "3"], h.io), 4);
  const e = JSON.parse(h.stderr().split("\n").filter(Boolean).pop());
  assert.equal(e.details.operation_id, 9);
});

test("y/N: пустой ответ и конец ввода (Ctrl-D) — «нет»", async () => {
  const io = (text) => ({ stdin: Readable.from(text === null ? [] : [text]), stderr: { write() {} } });
  assert.equal(await ask("Apply? [y/N] ", io("\n")), false);
  assert.equal(await ask("Apply? [y/N] ", io(null)), false);
  assert.equal(await ask("Apply? [y/N] ", io("y\n")), true);
});

test("подсказки повторяют способ запуска (REQ-01): npx-префикс вместо rentprog", async () => {
  const h = harness();
  h.io.argv0 = "npx -y @rentprog/cli@0";
  assert.equal(await main(["whoami"], h.io), 2);
  assert.match(JSON.parse(h.stderr()).message, /npx -y @rentprog\/cli@0 login/);
});

test("закрытый stdout (| head) — без стека и с кодом 0", { timeout: 20_000 }, async (t) => {
  const many = Array.from({ length: 3000 }, (_, i) => R(`tool_${i}`));
  const srv = await startFakeServer({ tools: many, handler: async () => ({ structuredContent: {} }) });
  t.after(srv.close);
  const child = spawn(process.execPath, ["bin/rentprog.js", "tools", "--format", "json"], { env: { ...process.env, RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url, XDG_CACHE_HOME: "/dev/null/x" } });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.stdout.once("data", () => child.stdout.destroy());
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0, err);
  assert.doesNotMatch(err, /EPIPE|at /);
});

test("прокси окружения используется и при NODE_USE_ENV_PROXY=1 (Node 20/22 его не поддерживают)", async (t) => {
  const target = await startFakeServer({ tools: [R("whoami")], handler: async () => ({ content: [] }) });
  t.after(target.close);
  let proxied = 0;
  const proxy = http.createServer((req, res) => { proxied++; res.writeHead(502); res.end(); });
  proxy.on("connect", (req, sock) => { proxied++; sock.destroy(); });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { proxy.closeAllConnections(); proxy.close(() => r()); }));
  await assert.rejects(connect({ url: target.url.replace("127.0.0.1", "localhost"), key: target.key, timeoutMs: 3000, env: { HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, NODE_USE_ENV_PROXY: "1", NO_PROXY: "" } }));
  assert.ok(proxied > 0, "request bypassed the proxy");
});
