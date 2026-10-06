// test/config.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, saveConfig, loadConfig, deleteConfig } from "../src/config.js";

test("настройки: каталог 0700, файл 0600, атомарная запись, исправление прав", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "rp-"));
  const paths = configPaths({ XDG_CONFIG_HOME: join(home, "cfg"), XDG_CACHE_HOME: join(home, "cache") }, "linux");
  saveConfig(paths, { url: "https://api.rentprog.ru/mcp", key: "rpa_x" });
  assert.equal(statSync(paths.dir).mode & 0o777, 0o700);
  assert.equal(statSync(paths.file).mode & 0o777, 0o600);
  chmodSync(paths.file, 0o644);
  saveConfig(paths, { url: "https://api.rentprog.ru/mcp", key: "rpa_y" });
  assert.equal(statSync(paths.file).mode & 0o777, 0o600);
  assert.equal(loadConfig(paths).key, "rpa_y");
  deleteConfig(paths);
  assert.equal(loadConfig(paths), null);
});

test("loadConfig исправляет права существующего файла на 0600 (§6)", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "rp-"));
  const paths = configPaths({ XDG_CONFIG_HOME: join(home, "cfg"), XDG_CACHE_HOME: join(home, "cache") }, "linux");
  saveConfig(paths, { url: "https://api.rentprog.ru/mcp", key: "rpa_x" });
  chmodSync(paths.file, 0o644);
  loadConfig(paths);
  assert.equal(statSync(paths.file).mode & 0o777, 0o600);
});
