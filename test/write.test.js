// test/write.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "../testkit/fake-server.js";
import { connect } from "../src/client.js";
import { runWrite } from "../src/write.js";
import { interactive } from "../src/tty.js";
import { exitCode } from "../src/exit.js";

const W = { name: "update_client", inputSchema: { type: "object", required: ["client_id"], properties: { client_id: { type: "integer" }, idempotency_key: { type: "string" }, preview_token: { type: "string" } } }, annotations: { readOnlyHint: false } };
const io = () => { const out = []; return { out, stdout: { write: (s) => out.push(["o", s]), isTTY: false }, stderr: { write: (s) => out.push(["e", s]) } }; };

function journal() {   // моделирует Executor: ключ → операция; токен только в первом ответе
  const ops = new Map();
  return async (name, a) => {
    if (!a.idempotency_key) return { isError: true, structuredContent: { error: "validation_failed", details: {} } };
    const op = ops.get(a.idempotency_key);
    if (!op) { ops.set(a.idempotency_key, { status: "previewed", token: "T1", args: a }); return { structuredContent: { status: "previewed", preview_token: "T1", effect: { x: 1 } } }; }
    if (a.preview_token === op.token) { op.status = "done"; return { structuredContent: { status: "done", result: { id: 1 } } }; }
    return { structuredContent: { status: op.status } };   // повтор без токена — снимок без T
  };
}

test("агент без TTY: previewed → код 11, подсказка с K и T без аргументов; повтор с K и T исполняет", async () => {
  const srv = await startFakeServer({ tools: [W], handler: journal() });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  const o = io();
  const r1 = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: {}, io: o, isInteractive: false, ask: async () => assert.fail("no question") });
  assert.equal(exitCode(r1.outcome).code, 11);
  const hint = o.out.filter(([k]) => k === "e").map(([, s]) => s).join("");
  const key = hint.match(/--idempotency-key (\S+)/)[1];
  assert.match(hint, /--preview-token T1/); assert.doesNotMatch(hint, /client-id/);
  const r2 = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { idempotencyKey: key, previewToken: "T1" }, io: io(), isInteractive: false, ask: async () => false });
  assert.equal(exitCode(r2.outcome).code, 0);
  await c.close(); await srv.close();
});

test("повтор тем же ключом без токена → previewed без T → код 6 (строка 16)", async () => {
  const srv = await startFakeServer({ tools: [W], handler: journal() });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { idempotencyKey: "same-key-0001" }, io: io(), isInteractive: false, ask: async () => false });
  const r = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { idempotencyKey: "same-key-0001" }, io: io(), isInteractive: false, ask: async () => false });
  assert.equal(exitCode(r.outcome).code, 6);
  await c.close(); await srv.close();
});

test("--yes вне интерактива подтверждает и исполняет тем же ключом", async () => {
  const srv = await startFakeServer({ tools: [W], handler: journal() });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  const r = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { yes: true }, io: io(), isInteractive: false, ask: async () => assert.fail("no question") });
  assert.equal(exitCode(r.outcome).code, 0);
  assert.equal(srv.calls[0].arguments.idempotency_key, srv.calls[1].arguments.idempotency_key);
  await c.close(); await srv.close();
});

test("интерактив: «N» → 11; «y» → исполнение", async () => {
  for (const [answer, code] of [[false, 11], [true, 0]]) {
    const srv = await startFakeServer({ tools: [W], handler: journal() });
    const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
    const r = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: {}, io: io(), isInteractive: true, ask: async () => answer });
    assert.equal(exitCode(r.outcome).code, code);
    await c.close(); await srv.close();
  }
});

test("интерактив только при stdin и stdout-TTY без --no-input (pty агента без stdin-TTY не спрашивает)", () => {
  assert.equal(interactive({ stdin: { isTTY: true }, stdout: { isTTY: true }, cli: {}, env: {} }), true);
  assert.equal(interactive({ stdin: { isTTY: false }, stdout: { isTTY: true }, cli: {}, env: {} }), false);
  assert.equal(interactive({ stdin: { isTTY: true }, stdout: { isTTY: true }, cli: { noInput: true }, env: {} }), false);
  assert.equal(interactive({ stdin: { isTTY: true }, stdout: { isTTY: true }, cli: {}, env: { RENTPROG_NO_INPUT: "1" } }), false);
});

test("обрыв после отправки записи → код 5 и ключ в stderr; повтор тем же ключом — снимок, не вторая операция", async () => {
  let n = 0; const seen = new Set();
  const srv = await startFakeServer({ tools: [W], handler: async (name, a) => {
    n++; if (n === 1) return { destroy: true };
    seen.add(a.idempotency_key); return { structuredContent: { status: "done" } };
  } });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  const o = io();
  const r = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { yes: true }, io: o, isInteractive: false, ask: async () => false });
  assert.equal(exitCode(r.outcome).code, 5);
  const key = o.out.map(([, s]) => s).join("").match(/idempotency_key: (\S+)/)[1];
  await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { idempotencyKey: key, yes: true }, io: io(), isInteractive: false, ask: async () => false });
  assert.deepEqual([...seen], [key]);
  await c.close(); await srv.close();
});

test("file_upload_url: ключ не добавляется, если его нет в схеме", async () => {
  const F = { name: "file_upload_url", inputSchema: { type: "object", additionalProperties: false, properties: { filename: { type: "string" } } }, annotations: { readOnlyHint: false } };
  const srv = await startFakeServer({ tools: [F], handler: async (n, a) => ({ structuredContent: { status: "issued", seen: a } }) });
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  const r = await runWrite({ client: c, tool: F, args: { filename: "a.jpg" }, cli: {}, io: io(), isInteractive: false, ask: async () => false });
  assert.deepEqual(r.result.structuredContent.seen, { filename: "a.jpg" });
  await c.close(); await srv.close();
});

test("продолжение через --args с preview_token: снимок previewed без токена → 11, а не 6 (§1.6)", async (t) => {
  const srv = await startFakeServer({ tools: [W], handler: async () => ({ structuredContent: { status: "previewed" } }) });
  t.after(srv.close);
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  t.after(() => c.close());
  const r = await runWrite({ client: c, tool: W, args: { client_id: 5, preview_token: "T1" }, cli: { idempotencyKey: "same-key-0001" }, io: io(), isInteractive: false, ask: async () => false });
  assert.equal(srv.calls[0].arguments.preview_token, "T1");
  assert.equal(exitCode(r.outcome).code, 11);
});

test("--yes: после подтверждения снимок previewed без токена → 11 (токен был в вызове), а не 6", async (t) => {
  let n = 0;
  const srv = await startFakeServer({ tools: [W], handler: async () => (++n === 1 ? { structuredContent: { status: "previewed", preview_token: "T1" } } : { structuredContent: { status: "previewed" } }) });
  t.after(srv.close);
  const c = await connect({ url: srv.url, key: srv.key, timeoutMs: 5000, env: {} });
  t.after(() => c.close());
  const r = await runWrite({ client: c, tool: W, args: { client_id: 5 }, cli: { yes: true }, io: io(), isInteractive: false, ask: async () => false });
  assert.equal(exitCode(r.outcome).code, 11);
});
