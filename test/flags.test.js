// test/flags.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseToolArgs, RESERVED, shape } from "../src/flags.js";
import { validateArgs } from "../src/validate.js";

const S = { type: "object", required: ["client_id"], properties: {
  client_id: { type: "integer" }, per_page: { type: "integer", minimum: 1, maximum: 50 }, active: { type: "boolean" },
  kinds: { type: "array", items: { type: "string", enum: ["a", "b"] } }, tags: { type: "array", items: { type: "string" } },
  payments: { type: "array", items: { type: "object" } }, state: { type: "string", enum: ["new", "done"] } } };

test("snake → kebab, булевы, enum-массив запятыми, строковый массив — повтор, объекты — JSON", () => {
  const { args } = parseToolArgs(["--client-id", "5", "--per-page", "50", "--no-active", "--kinds", "a,b", "--tag", "x,y", "--tag", "z", "--payments", '[{"sum":1}]'], { ...S, properties: { ...S.properties, tag: S.properties.tags } });
  assert.deepEqual(args, { client_id: 5, per_page: 50, active: false, kinds: ["a", "b"], tag: ["x,y", "z"], payments: [{ sum: 1 }] });
});

test("--args — основа, флаг заменяет свойство целиком", () => {
  const { args } = parseToolArgs(["--args", '{"client_id":1,"kinds":["a"]}', "--kinds", "b"], S);
  assert.deepEqual(args, { client_id: 1, kinds: ["b"] });
});

test("служебные флаги не уходят в аргументы", () => {
  const { args, cli } = parseToolArgs(["--client-id", "1", "--format", "csv", "--all", "--max-pages", "3", "--wait", "30", "--yes", "--idempotency-key", "k12345678"], { ...S, properties: { ...S.properties, idempotency_key: { type: "string" } } });
  assert.deepEqual(cli, { format: "csv", all: true, maxPages: 3, wait: 30, yes: true, idempotencyKey: "k12345678" });
  assert.deepEqual(args, { client_id: 1, idempotency_key: "k12345678" });
});

test("ошибки до отправки — код 2: не число, вне enum, нет обязательного, неизвестный флаг", () => {
  assert.throws(() => parseToolArgs(["--client-id", "abc"], S), { code: 2 });
  assert.throws(() => validateArgs({ client_id: 1, state: "x" }, S), { code: 2 });
  assert.throws(() => validateArgs({ per_page: 5 }, S), { code: 2 });
  assert.throws(() => validateArgs({ client_id: 1, per_page: 51 }, S), { code: 2 });
  assert.throws(() => parseToolArgs(["--nope", "1"], S), { code: 2 });
});

// Значение-образец для свойства схемы: argv флага (или --args для служебных имён) и ожидаемый аргумент.
const PATTERN_SAMPLES = { "^\\d{4}-\\d{2}-\\d{2}$": "2026-10-06", "^\\d{2}-\\d{2}-\\d{4} \\d{2}:\\d{2}$": "06-10-2026 10:00",
  "^\\d{2}-\\d{2}-\\d{4}$": "06-10-2026", "^#[0-9A-Fa-f]{6}$": "#1A2B3C", "^\\d+(\\.\\d+)?$": "10", "^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$": "data:image/png;base64,iVBORw0KGgo=" };
function sample(p) {
  if (Array.isArray(p.type)) return sample({ ...p, type: p.type.find((t) => t !== "null") });
  if (p.enum) return p.enum[0];
  if (p.type === "integer" || p.type === "number") return Math.max(p.minimum ?? 1, (p.exclusiveMinimum ?? 0) + 1);
  if (p.type === "boolean") return true;
  if (p.type === "array") return Array.from({ length: Math.max(p.minItems ?? 1, 1) }, () => sample(p.items ?? { type: "string" }));
  if (p.type === "object") return Object.fromEntries((p.required ?? []).map((k) => [k, sample(p.properties[k])]));
  if (p.pattern) { assert.ok(p.pattern in PATTERN_SAMPLES, `add a sample for pattern ${p.pattern}`); return PATTERN_SAMPLES[p.pattern]; }
  if (p.format === "date") return "2026-10-06";
  return "x".repeat(Math.max(p.minLength ?? 1, 1));
}
function argvFor(name, p, value) {
  const flag = `--${name.replaceAll("_", "-")}`;
  if (RESERVED.has(flag.slice(2)) && !["idempotency_key", "preview_token"].includes(name)) return ["--args", JSON.stringify({ [name]: value })];
  const s = shape(p);
  if (s.kind === "json") return [flag, JSON.stringify(value)];
  if (s.kind === "array") return value.flatMap((v) => [flag, String(v)]);
  if (s.type === "boolean" && s.kind !== "array") return [flag];
  return [flag, String(value)];
}

test("фикстура всех схем сервера (MET-02): каждое свойство каждого инструмента проходит флагом разбор и проверку", () => {
  const tools = JSON.parse(readFileSync(new URL("./fixtures/tools.json", import.meta.url)));
  assert.ok(tools.length >= 131, `fixture has ${tools.length} tools`);
  let props = 0;
  for (const t of tools) {
    const expected = {}; const argv = [];
    for (const [name, p] of Object.entries(t.inputSchema.properties ?? {})) {
      const value = sample(p); expected[name] = value; argv.push(...argvFor(name, p, value)); props++;
    }
    const { args } = parseToolArgs(argv, t.inputSchema);
    assert.deepEqual(args, expected, t.name);
    assert.doesNotThrow(() => validateArgs(args, t.inputSchema), t.name);
  }
  assert.ok(props > 1000, `only ${props} properties checked`);
});

test("схема записи с обязательным idempotency_key: проверка без служебных полей проходит, с ними — требует (P0 ревью)", () => {
  const tools = JSON.parse(readFileSync(new URL("./fixtures/tools.json", import.meta.url)));
  const w = tools.find((t) => t.annotations.readOnlyHint === false && (t.inputSchema.required ?? []).includes("idempotency_key"));
  assert.ok(w, "fixture has a write tool with required idempotency_key");
  const args = Object.fromEntries((w.inputSchema.required ?? []).filter((k) => k !== "idempotency_key").map((k) => [k, sample(w.inputSchema.properties[k])]));
  assert.throws(() => validateArgs(args, w.inputSchema), { code: 2 });
  assert.doesNotThrow(() => validateArgs(args, w.inputSchema, { skipRequired: ["idempotency_key", "preview_token"] }));
});
