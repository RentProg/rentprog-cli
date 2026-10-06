import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArgs } from "../src/validate.js";
import { parseToolArgs } from "../src/flags.js";

const S = { type: "object", additionalProperties: false, required: ["client_id"], properties: {
  client_id: { type: "integer", minimum: 1 }, note: { type: ["string", "null"], maxLength: 5 }, sum: { type: "number", exclusiveMinimum: 0 },
  kinds: { type: "array", items: { type: "string", enum: ["a", "b"] } }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  payments: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["sum"], properties: { sum: { type: "number" } } } },
  params: { type: "object", additionalProperties: { type: ["string", "number"] } } } };
const bad = (args, re) => assert.throws(() => validateArgs(args, S), (e) => e.code === 2 && re.test(e.message));

test("типы значений из --args проверяются до отправки (CTR-04)", () => {
  const { args } = parseToolArgs(["--args", '{"client_id":"abc"}'], S);
  bad(args, /--client-id: expected integer/);
});
test("вложенные объекты, массивы, enum элементов, границы, шаблон, лишние поля", () => {
  bad({ client_id: 1, payments: [{ sum: "x" }] }, /--payments\[0\]\.sum: expected number/);
  bad({ client_id: 1, payments: [] }, /at least 1 items/);
  bad({ client_id: 1, payments: [{}] }, /missing required --payments\[0\]\.sum/);
  bad({ client_id: 1, kinds: ["a", "z"] }, /--kinds\[1\]: one of a, b/);
  bad({ client_id: 1, sum: 0 }, /greater than 0/);
  bad({ client_id: 1, date: "06.10.2026" }, /must match/);
  bad({ client_id: 1, note: "toolong" }, /at most 5/);
  bad({ client_id: 1, extra: 1 }, /unknown argument --extra/);
  bad({ client_id: 1, params: { a: true } }, /--params\.a: expected string or number/);
  bad({}, /missing required --client-id/);
  assert.doesNotThrow(() => validateArgs({ client_id: 1, note: null, params: { a: "x", b: 2 }, payments: [{ sum: 1 }], kinds: ["b"] }, S));
});
test("nullable-скаляр: флаг с типом или null (cli-contract §1.5)", () => {
  assert.deepEqual(parseToolArgs(["--client-id", "1", "--note", "null"], S).args, { client_id: 1, note: null });
  assert.deepEqual(parseToolArgs(["--client-id", "1", "--note", "hi"], S).args, { client_id: 1, note: "hi" });
});
test("служебные флаги проверяются: формат, --max-pages ≥ 1, значение обязательно", () => {
  assert.throws(() => parseToolArgs(["--format", "xml"], S), { code: 2 });
  assert.throws(() => parseToolArgs(["--max-pages", "0"], S), { code: 2 });
  assert.throws(() => parseToolArgs(["--client-id"], S), { code: 2 });
  assert.throws(() => parseToolArgs(["--args", "[1]"], S), { code: 2 });
});

test("nullable boolean: --x → true, --no-x → false, --x=null → null (§1.2, §1.5)", () => {
  const B = { type: "object", properties: { vip: { type: ["boolean", "null"] } } };
  assert.deepEqual(parseToolArgs(["--vip"], B).args, { vip: true });
  assert.deepEqual(parseToolArgs(["--no-vip"], B).args, { vip: false });
  assert.deepEqual(parseToolArgs(["--vip=null"], B).args, { vip: null });
  assert.throws(() => parseToolArgs(["--vip=maybe"], B), { code: 2 });
  assert.throws(() => parseToolArgs(["--no-vip=null"], B), { code: 2 });
});

test("union: anyOf — хотя бы одна ветка, oneOf — ровно одна; соседние ограничения проверяются после union", () => {
  const U = { type: "object", properties: {
    a: { anyOf: [{ type: "string" }, { type: "integer" }] },
    o: { oneOf: [{ type: "integer" }, { type: "number" }] },
    m: { anyOf: [{ type: "integer" }, { type: "string" }], minimum: 5 } } };
  assert.doesNotThrow(() => validateArgs({ a: "x", o: 1.5, m: 7 }, U));
  assert.throws(() => validateArgs({ a: true }, U), (e) => /--a: does not match any allowed form/.test(e.message));
  assert.throws(() => validateArgs({ o: 2 }, U), (e) => /--o: must match exactly one allowed form/.test(e.message));
  assert.throws(() => validateArgs({ m: 3 }, U), (e) => /--m: minimum 5/.test(e.message));
});

test("--no-x только у boolean: у другого типа — 2, следующий токен не съедается", () => {
  assert.throws(() => parseToolArgs(["--no-client-id", "5"], S), (e) => e.code === 2 && /only for boolean/.test(e.message));
});
