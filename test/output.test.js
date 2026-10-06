// test/output.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, defaultFormat } from "../src/output.js";

test("формат по умолчанию — от stdout; RENTPROG_FORMAT переопределяет", () => {
  assert.equal(defaultFormat({ stdoutIsTTY: true, env: {} }), "table");
  assert.equal(defaultFormat({ stdoutIsTTY: false, env: {} }), "json");
  assert.equal(defaultFormat({ stdoutIsTTY: true, env: { RENTPROG_FORMAT: "csv" } }), "csv");
});

test("json — как есть", () => assert.equal(render({ a: 1 }, "json"), '{\n  "a": 1\n}\n'));

test("csv: строки items, вложенное — JSON, пусто — заголовок", () => {
  assert.equal(render({ items: [{ id: 1, client: { id: 2, name: "A, B" } }] }, "csv"), 'id,client\n1,"{""id"":2,""name"":""A, B""}"\n');
  assert.equal(render({ items: [] }, "csv"), "\n");
  assert.equal(render({ total: 3 }, "csv"), "key,value\ntotal,3\n");
});

test("table: колонки по первой строке, вложенный объект — name / id, массив — число", () => {
  const out = render({ items: [{ id: 1, client: { id: 2, name: "Anna" }, tags: [1, 2] }] }, "table");
  assert.match(out, /id\s+client\s+tags/);
  assert.match(out, /1\s+Anna\s+2/);
});

test("table: вложенный объект — name раньше display_name и id (cli-contract §2)", () => {
  assert.match(render({ items: [{ car: { id: 7, name: "Kia", display_name: "Kia Rio A001" } }] }, "table"), /\nKia\n?$/);
  assert.match(render({ items: [{ car: { id: 7, display_name: "Kia Rio" } }] }, "table"), /Kia Rio/);
});

test("help: nullable boolean — --x | --no-x | --x=null", async () => {
  const { helpText } = await import("../src/help.js");
  const out = helpText({ name: "t", description: "T.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { active: { type: ["boolean", "null"] } } } });
  assert.match(out, /--active \| --no-active \| --active=null/);
});
