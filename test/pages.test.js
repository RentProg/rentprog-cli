// test/pages.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAll } from "../src/pages.js";

const schema = { properties: { page: { type: "integer" } } };
test("склеивает страницы до has_more=false; конверт pages/count/total", async () => {
  const pages = { 1: { items: [1, 2], has_more: true, total: 3 }, 2: { items: [3], has_more: false, total: 3 } };
  assert.deepEqual(await fetchAll((p) => pages[p], { schema, maxPages: 20 }), { items: [1, 2, 3], pages: 2, count: 3, total: 3, has_more: false, truncated: false });
});
test("предохранитель max-pages → truncated", async () => {
  const env = await fetchAll(() => ({ items: [1], has_more: true }), { schema, maxPages: 2 });
  assert.equal(env.truncated, true); assert.equal(env.pages, 2); assert.equal(env.total, null);
});
test("--all не поддержан: нет page в схеме или нет items/has_more в корне → код 2 (NEG-04)", async () => {
  await assert.rejects(fetchAll(() => ({ items: [], has_more: false }), { schema: { properties: { before: {} } }, maxPages: 2 }), { code: 2 });
  await assert.rejects(fetchAll(() => ({ buckets: [] }), { schema, maxPages: 2 }), { code: 2 });
});
