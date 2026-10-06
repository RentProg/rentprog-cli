// test/hosts.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, isAllowedUrl, resolveCredentials, maskKey } from "../src/hosts.js";

test("канонический адрес: нижний регистр, путь /mcp", () => {
  assert.equal(canonicalUrl("HTTPS://API.RentProg.ru/mcp/"), "https://api.rentprog.ru/mcp");
  assert.throws(() => canonicalUrl("https://api.rentprog.ru/other"), { code: 2 });
});

test("разрешены хосты RentProg по https и loopback; чужой — только с allowHost", () => {
  for (const u of ["https://rentprog.net/mcp", "https://api.rentprog.ru/mcp", "https://api.rentprog.com/mcp", "https://rentprog.pro/mcp", "http://localhost:3300/mcp", "http://127.0.0.1/mcp", "http://[::1]:3000/mcp"])
    assert.equal(isAllowedUrl(u, {}), true, u);
  assert.equal(isAllowedUrl("http://rentprog.net/mcp", {}), false);
  assert.equal(isAllowedUrl("https://evil.example/mcp", {}), false);
  assert.equal(isAllowedUrl("https://evil.example/mcp", { allowHost: true }), true);
});

test("сохранённый ключ не уходит на другой адрес из RENTPROG_MCP_URL (NEG-02)", () => {
  const saved = { url: "https://api.rentprog.ru/mcp", key: "rpa_saved1234" };
  assert.throws(() => resolveCredentials({ env: { RENTPROG_MCP_URL: "https://rentprog.pro/mcp" }, saved, flags: {} }), { code: 2 });
  assert.deepEqual(resolveCredentials({ env: {}, saved, flags: {} }), { ...saved, source: "config" });
});

test("ключ из окружения: адрес из RENTPROG_MCP_URL или по умолчанию; чужой хост — только --allow-host", () => {
  assert.equal(resolveCredentials({ env: { RENTPROG_API_KEY: "rpa_env" }, saved: null, flags: {} }).url, "https://api.rentprog.ru/mcp");
  assert.throws(() => resolveCredentials({ env: { RENTPROG_API_KEY: "rpa_env", RENTPROG_MCP_URL: "https://evil.example/mcp" }, saved: null, flags: {} }), { code: 2 });
  assert.equal(resolveCredentials({ env: { RENTPROG_API_KEY: "rpa_env", RENTPROG_MCP_URL: "https://evil.example/mcp" }, saved: null, flags: { allowHost: true } }).url, "https://evil.example/mcp");
});

test("маска ключа", () => assert.equal(maskKey("rpa_abcdefgh1234"), "rpa_…1234"));
