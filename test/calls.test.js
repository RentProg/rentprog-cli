// Вызов инструментов через main(): коды выхода на настоящих HTTP-ответах, --all, --wait, таймаут, ошибки.
// Тесты --wait ограничены 15 с: бесконечный опрос (сломанный срок) падает быстро, а не по таймауту всего прогона.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "../testkit/fake-server.js";
import { harness } from "../testkit/harness.js";
import { main } from "../src/cli.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOOLS = [
  { name: "list_bookings", description: "Bookings.", inputSchema: { type: "object", properties: { page: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  { name: "crm_messages", description: "Cursor pages.", inputSchema: { type: "object", properties: { before: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  { name: "operation_status", description: "Op.", inputSchema: { type: "object", required: ["operation_id"], properties: { operation_id: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  { name: "pay_fine", description: "Pay.", inputSchema: { type: "object", required: ["fine_id", "idempotency_key"], properties: { fine_id: { type: "integer" }, idempotency_key: { type: "string" }, preview_token: { type: "string" } } }, annotations: { readOnlyHint: false } },
];
async function run(handler, argv, env = {}) {
  const srv = await startFakeServer({ tools: TOOLS, handler });
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url, RENTPROG_WAIT_INTERVAL_MS: "20", ...env });
  try { return { code: await main(argv, h.io), h, srv }; } finally { await srv.close(); }
}

test("HTTP 403 → 3; 5xx: чтение → 4, запись → 5; 429 → 4 с retry_after в details", async () => {
  assert.equal((await run(async () => ({ http: 403 }), ["list_bookings"])).code, 3);
  assert.equal((await run(async () => ({ http: 502 }), ["list_bookings"])).code, 4);
  assert.equal((await run(async () => ({ http: 502 }), ["pay_fine", "--fine-id", "1", "--yes"])).code, 5);
  const r = await run(async () => ({ http: 429, headers: { "retry-after": "7" } }), ["list_bookings"]);
  assert.equal(r.code, 4);
  assert.equal(JSON.parse(r.h.stderr()).details.retry_after, 7);
});

test("таймаут запроса (RENTPROG_TIMEOUT): чтение → 4, запись → 5 и подсказка повтора с тем же ключом (FM-03)", async () => {
  const slow = async () => { await sleep(3000); return { structuredContent: {} }; };
  assert.equal((await run(slow, ["list_bookings"], { RENTPROG_TIMEOUT: "1" })).code, 4);
  const w = await run(slow, ["pay_fine", "--fine-id", "1", "--yes"], { RENTPROG_TIMEOUT: "1" });
  assert.equal(w.code, 5);
  const err = JSON.parse(w.h.stderr().split("\n").filter(Boolean).pop());
  assert.match(err.details.idempotency_key, /^cli-/);
  assert.match(err.message, /--idempotency-key cli-/);
});

test("--all: total первой страницы, 429 посреди листания → 4 и ничего не печатается; --max-pages → предупреждение", async () => {
  const pages = async (n, a) => ({ structuredContent: { items: [{ id: a.page }], has_more: true, total: 100 - a.page } });
  const r = await run(pages, ["list_bookings", "--all", "--max-pages", "2"]);
  assert.equal(r.code, 0);
  const env = JSON.parse(r.h.stdout());
  assert.deepEqual([env.pages, env.count, env.total, env.truncated], [2, 2, 99, true]);
  assert.match(r.h.stderr(), /--max-pages 2/);
  const mid = await run(async (n, a) => (a.page === 2 ? { http: 429 } : { structuredContent: { items: [1], has_more: true } }), ["list_bookings", "--all"]);
  assert.equal(mid.code, 4); assert.equal(mid.h.stdout(), "");
  assert.equal((await run(pages, ["crm_messages", "--all"])).code, 2);
});

test("ошибка инструмента чтения → stderr JSON, код по §3; stdout пуст", async () => {
  const r = await run(async () => ({ isError: true, structuredContent: { error: "not_found", message: "No booking", details: {} } }), ["list_bookings"]);
  assert.equal(r.code, 3); assert.equal(r.h.stdout(), "");
  assert.deepEqual(JSON.parse(r.h.stderr()), { error: "not_found", message: "No booking", details: {}, exit_code: 3 });
});

test("запись: --all → 2 без вызова; --help → 0 без вызова; ключ обязателен в схеме, но CLI генерирует его сам", async () => {
  const h1 = await run(async () => ({ structuredContent: { status: "done" } }), ["pay_fine", "--fine-id", "1", "--all"]);
  assert.equal(h1.code, 2); assert.equal(h1.srv.calls.length, 0);
  const h2 = await run(async () => ({ structuredContent: { status: "done" } }), ["pay_fine", "--help"]);
  assert.equal(h2.code, 0); assert.equal(h2.srv.calls.length, 0);
  const h3 = await run(async () => ({ structuredContent: { status: "done" } }), ["pay_fine", "--fine-id", "1"]);
  assert.equal(h3.code, 0); assert.match(h3.srv.calls[0].arguments.idempotency_key, /^cli-/);
});

const approval = (final) => async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : final());

test("--wait: pending_approval → опрос → done 0 / rejected 3 / failed без retryable 5", { timeout: 15_000 }, async () => {
  const st = (status, extra = {}) => () => ({ structuredContent: { status, operation_id: 9, ...extra } });
  assert.equal((await run(approval(st("done")), ["pay_fine", "--fine-id", "1", "--wait", "5"])).code, 0);
  assert.equal((await run(approval(st("rejected")), ["pay_fine", "--fine-id", "1", "--wait", "5"])).code, 3);
  assert.equal((await run(approval(st("failed", { error_code: "x" })), ["pay_fine", "--fine-id", "1", "--wait", "5"])).code, 5);
});

test("без --wait — 10 и подсказка operation_status; --wait истёк — 10 и подсказка (FM-05)", { timeout: 15_000 }, async () => {
  const pending = () => ({ structuredContent: { status: "pending_approval", operation_id: 9 } });
  const a = await run(approval(pending), ["pay_fine", "--fine-id", "1"]);
  assert.equal(a.code, 10); assert.match(a.h.stderr(), /operation_status --operation-id 9/);
  const t0 = Date.now();
  const b = await run(approval(pending), ["pay_fine", "--fine-id", "1", "--wait", "1"]);
  assert.equal(b.code, 10); assert.match(b.h.stderr(), /check later: rentprog operation_status --operation-id 9/);
  assert.ok(Date.now() - t0 < 3000);
});

test("--wait: 429 с Retry-After не продлевает ожидание дальше срока", { timeout: 15_000 }, async () => {
  const t0 = Date.now();
  const r = await run(approval(() => ({ http: 429, headers: { "retry-after": "30" } })), ["pay_fine", "--fine-id", "1", "--wait", "1"]);
  assert.equal(r.code, 10);
  assert.ok(Date.now() - t0 < 3000, `waited ${Date.now() - t0} ms`);
});

test("operation_status: retryable без статуса → 4 (строка 13)", async () => {
  const r = await run(async () => ({ structuredContent: { error: { code: "busy", details: { retryable: true } } } }), ["operation_status", "--operation-id", "9"]);
  assert.equal(r.code, 4);
});

test("неверный --format и RENTPROG_FORMAT → 2 до запроса", async () => {
  const a = await run(async () => ({ structuredContent: {} }), ["list_bookings", "--format", "xml"]);
  assert.equal(a.code, 2); assert.equal(a.srv.calls.length, 0);
  assert.equal((await run(async () => ({ structuredContent: {} }), ["list_bookings"], { RENTPROG_FORMAT: "yaml" })).code, 2);
});

test("--wait: сбой опроса operation_status — это чтение: 5xx и таймаут → 4 и подсказка operation_status", { timeout: 15_000 }, async () => {
  const a = await run(approval(() => ({ http: 502 })), ["pay_fine", "--fine-id", "1", "--wait", "5"]);
  assert.equal(a.code, 4);
  assert.match(JSON.parse(a.h.stderr().split("\n").filter(Boolean).pop()).message, /operation_status --operation-id 9/);
  const slow = async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : (await sleep(3000), { structuredContent: { status: "done" } }));
  assert.equal((await run(slow, ["pay_fine", "--fine-id", "1", "--wait", "5"], { RENTPROG_TIMEOUT: "1" })).code, 4);
});

test("operation_status --wait опрашивает ту же операцию; подсказка после 10 ведёт к ней, а не к повтору записи", { timeout: 15_000 }, async () => {
  let polls = 0;
  const h = async (name) => (name === "operation_status" ? { structuredContent: { status: ++polls < 3 ? "pending_approval" : "done", operation_id: 9 } } : { structuredContent: { status: "pending_approval", operation_id: 9 } });
  const r = await run(h, ["operation_status", "--operation-id", "9", "--wait", "5"]);
  assert.equal(r.code, 0); assert.equal(polls, 3);
  assert.equal(r.srv.calls.filter((c) => c.name === "pay_fine").length, 0);
  const w = await run(h, ["pay_fine", "--fine-id", "1"]);
  assert.equal(w.code, 10);
  assert.match(w.h.stderr(), /do not rerun the write\): rentprog operation_status --operation-id 9 --wait/);
});

test("--wait соблюдает Retry-After при 429 (cli-contract §7); дата вместо секунд — пауза 5 с, не горячий цикл", { timeout: 15_000 }, async () => {
  let polls = 0;
  const limited = (ra) => async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : (polls++, { http: 429, headers: { "retry-after": ra } }));
  await run(limited("1"), ["pay_fine", "--fine-id", "1", "--wait", "2"]);
  assert.ok(polls >= 2 && polls <= 4, `polls with Retry-After 1 s: ${polls}`);
  polls = 0;
  await run(limited("Wed, 21 Oct 2026 07:28:00 GMT"), ["pay_fine", "--fine-id", "1", "--wait", "1"]);
  assert.ok(polls <= 2, `polls with an HTTP-date Retry-After: ${polls}`);
});

test("--all без --max-pages останавливается на 20 страницах; ответ без has_more → 2", async () => {
  const r = await run(async (n, a) => ({ structuredContent: { items: [a.page], has_more: true } }), ["list_bookings", "--all"]);
  assert.equal(JSON.parse(r.h.stdout()).pages, 20);
  assert.equal((await run(async () => ({ structuredContent: { items: [1] } }), ["list_bookings", "--all"])).code, 2);
});

test("tools --format: csv работает, неизвестный формат → 2; help без имени → usage и 2; RENTPROG_TIMEOUT не число → 2", async () => {
  const a = await run(async () => ({}), ["tools", "--format", "csv"]);
  assert.equal(a.code, 0); assert.match(a.h.stdout(), /^name,kind,description\n/);
  assert.equal((await run(async () => ({}), ["tools", "--format", "xml"])).code, 2);
  const h = await run(async () => ({}), ["help"]);
  assert.equal(h.code, 2); assert.match(JSON.parse(h.h.stderr()).message, /^usage:/);
  assert.equal((await run(async () => ({}), ["list_bookings"], { RENTPROG_TIMEOUT: "abc" })).code, 2);
});

test("--no-input: ошибка в stderr — JSON даже в терминале (§2, §4)", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({}) });
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url });
  h.io.stdin.isTTY = true; h.io.stdout.isTTY = true;
  try {
    assert.equal(await main(["list_bookings", "--format", "xml", "--no-input"], h.io), 2);
    assert.equal(JSON.parse(h.stderr()).exit_code, 2);
  } finally { await srv.close(); }
});

test("--wait: зависший опрос не держит дольше срока — 10 к сроку, а не к RENTPROG_TIMEOUT", { timeout: 15_000 }, async () => {
  const hung = async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : (await sleep(8000), { structuredContent: { status: "done" } }));
  const t0 = Date.now();
  const r = await run(hung, ["pay_fine", "--fine-id", "1", "--wait", "1"]);
  assert.equal(r.code, 10);
  assert.ok(Date.now() - t0 < 4000, `waited ${Date.now() - t0} ms`);
});

test("operation_status --wait: сбой опроса — 4, в сообщении и details — operation_id", { timeout: 15_000 }, async () => {
  let n = 0;
  const h = async () => (++n === 1 ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : { http: 502 });
  const r = await run(h, ["operation_status", "--operation-id", "9", "--wait", "5"]);
  assert.equal(r.code, 4);
  const err = JSON.parse(r.h.stderr().split("\n").filter(Boolean).pop());
  assert.equal(err.details.operation_id, 9);
  assert.match(err.message, /operation_status --operation-id 9 --wait/);
});

test("usage без команды и help без имени — JSON в stderr вне терминала (§2)", async () => {
  const h = harness();
  assert.equal(await main([], h.io), 2);
  const e = JSON.parse(h.stderr());
  assert.equal(e.exit_code, 2); assert.match(e.message, /^usage:/);
});

test("operation_status --wait N соблюдает срок N; второй опрос — после паузы, не сразу", { timeout: 15_000 }, async () => {
  const pending = async () => ({ structuredContent: { status: "pending_approval", operation_id: 9 } });
  const t0 = Date.now();
  const a = await run(pending, ["operation_status", "--operation-id", "9", "--wait", "1"], { RENTPROG_WAIT_INTERVAL_MS: "200" });
  assert.equal(a.code, 10); assert.ok(Date.now() - t0 < 3000);
  let n = 0; const times = [];
  const h = async () => { times.push(Date.now()); return { structuredContent: { status: ++n < 2 ? "pending_approval" : "done", operation_id: 9 } }; };
  assert.equal((await run(h, ["operation_status", "--operation-id", "9", "--wait", "5"], { RENTPROG_WAIT_INTERVAL_MS: "300" })).code, 0);
  assert.ok(times[1] - times[0] >= 250, `second poll after ${times[1] - times[0]} ms`);
});

test("--wait при Retry-After: 0 не крутится вхолостую (пауза не меньше 1 с)", { timeout: 15_000 }, async () => {
  let polls = 0;
  const h = async (name) => (name === "pay_fine" ? { structuredContent: { status: "pending_approval", operation_id: 9 } } : (polls++, { http: 429, headers: { "retry-after": "0" } }));
  await run(h, ["pay_fine", "--fine-id", "1", "--wait", "2"]);
  assert.ok(polls <= 4, `polls: ${polls}`);
});

test("--wait у чтения, кроме operation_status, → 2 без вызова", async () => {
  const r = await run(async () => ({ structuredContent: {} }), ["list_bookings", "--wait", "5"]);
  assert.equal(r.code, 2); assert.equal(r.srv.calls.length, 0);
});

test("tools: формы --grep=… и --format=…, RENTPROG_FORMAT; неизвестный флаг → 2", async () => {
  const a = await run(async () => ({}), ["tools", "--grep=cursor", "--format=csv"]);
  assert.equal(a.code, 0); assert.equal(a.h.stdout(), "name,kind,description\ncrm_messages,read,Cursor pages.\n");
  const b = await run(async () => ({}), ["tools"], { RENTPROG_FORMAT: "csv" });
  assert.match(b.h.stdout(), /^name,kind,description\n/);
  assert.equal((await run(async () => ({}), ["tools", "--bogus"])).code, 2);
});

test("RENTPROG_TIMEOUT вне 1…3600 → 2", async () => {
  for (const v of ["0", "-1", "4000", "1e400"]) assert.equal((await run(async () => ({}), ["list_bookings"], { RENTPROG_TIMEOUT: v })).code, 2, v);
});

test("в терминале без --no-input ошибка — текстом, не JSON (§2)", async () => {
  const srv = await startFakeServer({ tools: TOOLS, handler: async () => ({}) });
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url });
  h.io.stdin.isTTY = true; h.io.stdout.isTTY = true;
  try {
    assert.equal(await main(["list_bookings", "--format", "xml"], h.io), 2);
    assert.match(h.stderr(), /^--format: one of json, table, csv\n$/);
  } finally { await srv.close(); }
});

test("operation_status --wait: зависший первый запрос не держит дольше срока; его сбой — с operation_id", { timeout: 15_000 }, async () => {
  const t0 = Date.now();
  const hung = await run(async () => { await sleep(8000); return { structuredContent: { status: "done" } }; }, ["operation_status", "--operation-id", "9", "--wait", "1"]);
  assert.equal(hung.code, 10); assert.ok(Date.now() - t0 < 4000, `waited ${Date.now() - t0} ms`);
  const down = await run(async () => ({ http: 502 }), ["operation_status", "--operation-id", "9", "--wait", "5"]);
  assert.equal(down.code, 4);
  assert.equal(JSON.parse(down.h.stderr().split("\n").filter(Boolean).pop()).details.operation_id, 9);
});

test("RENTPROG_TIMEOUT меньше секунды → 2; флаги tools без значения не принимают =…", async () => {
  assert.equal((await run(async () => ({}), ["list_bookings"], { RENTPROG_TIMEOUT: "0.5" })).code, 2);
  assert.equal((await run(async () => ({}), ["tools", "--read=nope"])).code, 2);
  assert.equal((await run(async () => ({}), ["tools", "--no-input=nope"])).code, 2);
});
