// test/version.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("--version печатает версию из package.json и выходит с 0", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const out = execFileSync(process.execPath, ["bin/rentprog.js", "--version"], { encoding: "utf8" });
  assert.equal(out.trim(), pkg.version);
});
