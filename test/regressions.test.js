// Регрессии ревью плана: схема записи с обязательным ключом, --help у записи, таймаут SDK.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { startFakeServer } from "../testkit/fake-server.js";
import { main } from "../src/cli.js";
import * as client from "../src/client.js";
import { exitCode } from "../src/exit.js";

const UPDATE_CLIENT = { name: "update_client", description: "Update a client.", annotations: { readOnlyHint: false },
  inputSchema: { type: "object", additionalProperties: false, required: ["client_id", "idempotency_key"], properties: {
    client_id: { type: "integer", minimum: 1 }, idempotency_key: { type: "string", minLength: 8 }, preview_token: { type: "string" } } } };
const harness = (srv) => { const home = mkdtempSync(join(tmpdir(), "rpr-")); const out = [], err = [];
  return { out, err, io: { env: { XDG_CONFIG_HOME: join(home, "c"), XDG_CACHE_HOME: join(home, "k"), RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url }, stdin: { isTTY: false }, stdout: { isTTY: false, write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, argv0: "rentprog" } }; };

test("схема записи как у api (required idempotency_key): CLI сам генерирует ключ → previewed → 11", async (t) => {
  const srv = await startFakeServer({ tools: [UPDATE_CLIENT], handler: async () => ({ structuredContent: { status: "previewed", preview_token: "T1" } }) });
  t.after(() => srv.close());
  const h = harness(srv);
  assert.equal(await main(["update_client", "--client-id", "5"], h.io), 11);
  assert.equal(srv.calls.length, 1);
  assert.match(srv.calls[0].arguments.idempotency_key, /^cli-/);
});

test("<write-tool> --help печатает справку и НЕ вызывает инструмент", async (t) => {
  const srv = await startFakeServer({ tools: [{ ...UPDATE_CLIENT, inputSchema: { ...UPDATE_CLIENT.inputSchema, required: ["idempotency_key"] } }], handler: async () => ({ structuredContent: { status: "done" } }) });
  t.after(() => srv.close());
  const h = harness(srv);
  assert.equal(await main(["update_client", "--help"], h.io), 0);
  assert.equal(srv.calls.length, 0);
  assert.match(h.out.join(""), /update_client \(writes\)/);
});

test("таймаут запроса SDK (McpError -32001) у записи → код 5, у чтения → 4", () => {
  const e = client.normalize(new McpError(ErrorCode.RequestTimeout, "Request timed out"), { status: null });
  assert.equal(exitCode({ kind: "transport", error: e, write: true }).code, 5);
  assert.equal(exitCode({ kind: "transport", error: e, write: false }).code, 4);
});

test("таймер запроса SDK на 5 с дольше RENTPROG_TIMEOUT, в том числе больше 60 с (ER-05)", () => {
  assert.deepEqual(client.sdkRequestOptions(70_000), { timeout: 75_000 });
  assert.deepEqual(client.sdkRequestOptions(1_000), { timeout: 6_000 });
});

test("connect передаёт SDK таймер RENTPROG_TIMEOUT + 5 с — и listTools, и callTool (ER-05)", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const seen = [];
  const origCall = Client.prototype.callTool, origList = Client.prototype.listTools;
  Client.prototype.callTool = function (p, s, o) { seen.push(["call", o]); return origCall.call(this, p, s, o); };
  Client.prototype.listTools = function (p, o) { seen.push(["list", o]); return origList.call(this, p, o); };
  t.after(() => { Client.prototype.callTool = origCall; Client.prototype.listTools = origList; });
  const srv = await startFakeServer({ tools: [UPDATE_CLIENT], handler: async () => ({ structuredContent: { status: "done" } }) });
  t.after(srv.close);
  const c = await client.connect({ url: srv.url, key: srv.key, timeoutMs: 90_000, env: {} });
  t.after(() => c.close());
  await c.listTools(); await c.callTool("update_client", { client_id: 1, idempotency_key: "k-00000001" });
  assert.deepEqual(seen, [["list", { timeout: 95_000 }], ["call", { timeout: 95_000 }]]);
});
