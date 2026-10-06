// testkit/harness.js — io for main(): non-TTY, captured stdout/stderr, own config and cache dirs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function harness(env = {}, { stdin = { isTTY: false } } = {}) {
  const home = mkdtempSync(join(tmpdir(), "rpc-"));
  const out = []; const err = [];
  const io = { env: { XDG_CONFIG_HOME: join(home, "c"), XDG_CACHE_HOME: join(home, "k"), ...env }, stdin, stdout: { isTTY: false, write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, argv0: "rentprog" };
  return { io, out, err, home, configFile: join(home, "c", "rentprog", "config.json"), cacheDir: join(home, "k", "rentprog"), stdout: () => out.join(""), stderr: () => err.join("") };
}
