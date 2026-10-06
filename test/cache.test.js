import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTools, writeTools } from "../src/cache.js";
import { startFakeServer } from "../testkit/fake-server.js";
import { harness } from "../testkit/harness.js";
import { main } from "../src/cli.js";

test("кеш tools/list: 60 с, отдельный файл на пару адрес+ключ, 0600 (CTR-05)", { skip: process.platform === "win32" }, () => {
  const paths = { cacheDir: join(mkdtempSync(join(tmpdir(), "rpk-")), "rentprog") };
  writeTools(paths, "u", "k1", [{ name: "a" }], 1_000);
  assert.deepEqual(readTools(paths, "u", "k1", 1_000 + 59_999), [{ name: "a" }]);
  assert.equal(readTools(paths, "u", "k1", 1_000 + 60_000), null);
  assert.equal(readTools(paths, "u", "k2", 1_000), null);
  const [file] = readdirSync(paths.cacheDir);
  assert.match(file, /^tools-[0-9a-f]{16}\.json$/);
  assert.equal(statSync(join(paths.cacheDir, file)).mode & 0o777, 0o600);
});

test("второй запуск в пределах минуты не делает tools/list; кеш недоступен на запись — команда работает", async (t) => {
  let lists = 0;
  const srv = await startFakeServer({ tools: [{ name: "whoami", description: ".", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }],
    handler: async () => ({ structuredContent: { user: { name: "I" } } }), onList: () => lists++ });
  t.after(srv.close);
  const h = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url });
  assert.equal(await main(["whoami"], h.io), 0);
  assert.equal(await main(["whoami"], h.io), 0);
  assert.equal(lists, 1);
  const ro = harness({ RENTPROG_API_KEY: srv.key, RENTPROG_MCP_URL: srv.url, XDG_CACHE_HOME: "/dev/null/nope" });
  assert.equal(await main(["whoami"], ro.io), 0);
});
