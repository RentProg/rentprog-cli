import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { startFakeServer } from "../testkit/fake-server.js";
import { harness } from "../testkit/harness.js";
import { main } from "../src/cli.js";

const R = (name) => ({ name, description: `${name}.`, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } });
const W = (name) => ({ ...R(name), annotations: { readOnlyHint: false } });
const who = async (name) => (name === "whoami" ? { structuredContent: { user: { name: "Ivan" }, levels: { crm: "preview" } } } : { structuredContent: {} });
const KEY = "rpa_test0001";

test("login сохраняет url и key, печатает владельца и уровни, ключ — только маской (EC-01, CON-03)", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami"), R("list_cars")], handler: who }); t.after(srv.close);
  const h = harness();
  assert.equal(await main(["login", KEY, "--url", srv.url], h.io), 0);
  assert.deepEqual(JSON.parse(readFileSync(h.configFile, "utf8")).key, KEY);
  assert.match(h.stderr(), /Ivan/); assert.match(h.stderr(), /"crm":"preview"/); assert.match(h.stderr(), /rpa_…0001/);
  assert.doesNotMatch(h.stderr() + h.stdout(), /rpa_test0001/);
});

test("неверный ключ (401) → 3; whoami с ошибкой → 3; в обоих случаях ничего не сохранено (NEG-01)", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami")], handler: async () => ({ isError: true, structuredContent: { error: "forbidden", message: "no" } }) }); t.after(srv.close);
  const h1 = harness();
  assert.equal(await main(["login", "rpa_wrong", "--url", srv.url], h1.io), 3);
  assert.equal(existsSync(h1.configFile), false);
  const h2 = harness();
  assert.equal(await main(["login", KEY, "--url", srv.url], h2.io), 3);
  assert.equal(existsSync(h2.configFile), false);
});

test("ключ прежнего формата (нет whoami) — сохраняется с предупреждением о перевыпуске", async (t) => {
  const srv = await startFakeServer({ tools: [R("list_cars")], handler: who }); t.after(srv.close);
  const h = harness();
  assert.equal(await main(["login", KEY, "--url", srv.url], h.io), 0);
  assert.match(h.stderr(), /previous format/);
  assert.ok(existsSync(h.configFile));
});

test("--key-stdin читает ключ из stdin", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami")], handler: who }); t.after(srv.close);
  const h = harness({}, { stdin: Object.assign(Readable.from([`${KEY}\n`]), { isTTY: false }) });
  assert.equal(await main(["login", "--key-stdin", "--url", srv.url], h.io), 0);
  assert.equal(JSON.parse(readFileSync(h.configFile, "utf8")).key, KEY);
});

test("чужой адрес: без --allow-host — 2; с --allow-host и ключом из окружения — попытка по https без сохранения (FM-02, §5)", async () => {
  const h = harness();
  assert.equal(await main(["login", "rpa_x", "--url", "https://evil.example/mcp"], h.io), 2);
  assert.equal(existsSync(h.configFile), false);
  // Чужой хост по https с --allow-host и ключом окружения: CLI идёт туда (здесь — несуществующий домен, код 4 до отправки),
  // но ничего не сохраняет; по http чужой хост — 2 до запроса (review-fixes.test.js)
  const h2 = harness({ RENTPROG_API_KEY: KEY });
  assert.equal(await main(["login", "--url", "https://foreign.invalid/mcp", "--allow-host"], h2.io), 4);
  assert.equal(existsSync(h2.configFile), false);
});

test("logout удаляет настройки и кеш; после — команда без ключа даёт 2", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami")], handler: who }); t.after(srv.close);
  const h = harness();
  assert.equal(await main(["login", KEY, "--url", srv.url], h.io), 0);
  assert.ok(existsSync(h.cacheDir));
  assert.equal(await main(["logout"], h.io), 0);
  assert.equal(existsSync(h.configFile), false); assert.equal(existsSync(h.cacheDir), false);
  assert.equal(await main(["whoami"], h.io), 2);
});

test("повреждённый config.json → 2 с подсказкой login", async () => {
  const h = harness();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(h.configFile.replace(/\/config\.json$/, ""), { recursive: true }); writeFileSync(h.configFile, "{oops");
  assert.equal(await main(["whoami"], h.io), 2);
  assert.match(h.stderr(), /run login again/);
});

test("сохранённый ключ и команды: whoami, tools --read/--write/--grep, help, неизвестный инструмент", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami"), R("list_cars"), W("update_client")], handler: who }); t.after(srv.close);
  const h = harness();
  await main(["login", KEY, "--url", srv.url], h.io);
  h.out.length = 0;
  assert.equal(await main(["whoami"], h.io), 0);
  assert.equal(JSON.parse(h.stdout()).user.name, "Ivan");
  const names = async (...a) => { h.out.length = 0; assert.equal(await main(["tools", ...a], h.io), 0); return JSON.parse(h.stdout()).items.map((x) => x.name); };
  assert.deepEqual(await names("--read"), ["whoami", "list_cars"]);
  assert.deepEqual(await names("--write"), ["update_client"]);
  assert.deepEqual(await names("--grep", "CARS"), ["list_cars"]);
  assert.equal(await main(["tools", "--grep"], h.io), 2);
  h.out.length = 0;
  assert.equal(await main(["help", "update_client"], h.io), 0);
  assert.match(h.stdout(), /update_client \(writes\)/); assert.match(h.stdout(), /--args/);
  assert.equal(await main(["nope"], h.io), 2);
  assert.equal(await main(["help", "nope"], h.io), 2);
});

test("RENTPROG_MCP_URL без RENTPROG_API_KEY, отличный от сохранённого, → 2, запрос не уходит (NEG-02)", async (t) => {
  const srv = await startFakeServer({ tools: [R("whoami")], handler: who }); t.after(srv.close);
  const h = harness();
  await main(["login", KEY, "--url", srv.url], h.io);
  const before = srv.calls.length;
  h.io.env.RENTPROG_MCP_URL = "https://rentprog.pro/mcp";
  assert.equal(await main(["whoami"], h.io), 2);
  assert.equal(srv.calls.length, before);
});

test("login --no-input в терминале не спрашивает ключ: 2 и JSON (§4)", async () => {
  const stdin = { isTTY: true, setRawMode: () => assert.fail("prompt opened"), setEncoding() {}, resume() {}, on() {}, off() {}, pause() {} };
  const h = harness({}, { stdin });
  h.io.stdout.isTTY = true;
  assert.equal(await main(["login", "--no-input", "--url", "https://api.rentprog.ru/mcp"], h.io), 2);
  assert.equal(JSON.parse(h.stderr()).exit_code, 2);
});
