// test/cli.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeServer } from "../testkit/fake-server.js";
import { main } from "../src/cli.js";

const TOOLS = [
  { name: "whoami", description: "Who owns this key. Levels.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "list_bookings", description: "Bookings list. Pages.", inputSchema: { type: "object", properties: { page: { type: "integer" }, per_page: { type: "integer", maximum: 50 } } }, annotations: { readOnlyHint: true } },
  { name: "operation_status", description: "Status of a write operation.", inputSchema: { type: "object", required: ["operation_id"], properties: { operation_id: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  { name: "pay_fine", description: "Pay a fine.", inputSchema: { type: "object", properties: { fine_id: { type: "integer" }, idempotency_key: { type: "string" } } }, annotations: { readOnlyHint: false } },
];
function harness(env = {}) {
  const home = mkdtempSync(join(tmpdir(), "rpc-"));
  const out = []; const err = [];
  const io = { env: { XDG_CONFIG_HOME: join(home, "c"), XDG_CACHE_HOME: join(home, "k"), ...env }, stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, argv0: "rentprog" };
  return { io, out, err, home };
}
const handler = async (name, a) => {
  if (name === "whoami") return { structuredContent: { user: { name: "Ivan" }, levels: { crm: "preview" } } };
  if (name === "list_bookings") return { structuredContent: { items: [{ id: a.page }], has_more: a.page < 3, total: 3 } };
  if (name === "pay_fine") return { structuredContent: { status: "pending_approval", operation_id: 9 } };
  if (name === "operation_status") return { structuredContent: { status: "done", operation_id: 9 } };
};

test("login: проверка ключа, печать уровней, сохранение; неверный ключ — 3 и без сохранения (NEG-01)", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler });
  const h = harness();
  assert.equal(await main(["login", "rpa_wrong", "--url", srv.url], h.io), 3);
  assert.equal(existsSync(join(h.home, "c", "rentprog", "config.json")), false);
  assert.equal(await main(["login", srv.key, "--url", srv.url], h.io), 0);
  assert.match(h.err.join("") + h.out.join(""), /Ivan/);
  await srv.close();
});

test("login на чужой адрес без --allow-host — 2, ничего не сохранено (FM-02)", async () => {
  const h = harness();
  assert.equal(await main(["login", "rpa_x", "--url", "https://evil.example/mcp"], h.io), 2);
  assert.equal(existsSync(join(h.home, "c", "rentprog", "config.json")), false);
});

test("tools --grep и help; вызов --all склеивает страницы; неизвестный инструмент — 2 (NEG-03)", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler });
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url });
  assert.equal(await main(["tools", "--grep", "PAGES"], h.io), 0);
  assert.match(h.out.join(""), /list_bookings/); assert.doesNotMatch(h.out.join(""), /whoami/);
  h.out.length = 0;
  assert.equal(await main(["list_bookings", "--all"], h.io), 0);
  assert.deepEqual(JSON.parse(h.out.join("")).items, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(await main(["nope"], h.io), 2);
  assert.equal(await main(["list_bookings", "--per-page", "abc"], h.io), 2);
  await srv.close();
});

test("запись pending_approval: без --wait — 10 и operation_id; с --wait — опрос до done → 0", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler });
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url, RENTPROG_WAIT_INTERVAL_MS: "10" });
  assert.equal(await main(["pay_fine", "--fine-id", "1"], h.io), 10);
  assert.equal(await main(["pay_fine", "--fine-id", "1", "--wait", "5"], h.io), 0);
  await srv.close();
});

test("ошибка вне интерактива — JSON в stderr с exit_code", async () => {
  const h = harness({ RENTPROG_API_KEY: "rpa_x", RENTPROG_MCP_URL: "https://evil.example/mcp" });
  assert.equal(await main(["whoami"], h.io), 2);
  assert.equal(JSON.parse(h.err.join("")).exit_code, 2);
});
