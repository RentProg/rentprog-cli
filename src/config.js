// src/config.js
import { mkdirSync, writeFileSync, renameSync, chmodSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CliError } from "./errors.js";

export function configPaths(env = process.env, platform = process.platform) {
  const base = platform === "win32"
    ? join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "rentprog")
    : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "rentprog");
  const cache = platform === "win32" ? join(base, "cache") : join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "rentprog");
  return { dir: base, file: join(base, "config.json"), cacheDir: cache };
}

export function saveConfig(paths, { url, key }) {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dir, 0o700);
  const tmp = `${paths.file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ url, key, checked_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, paths.file);
}

export function loadConfig(paths) {
  if (!existsSync(paths.file)) return null;
  try { chmodSync(paths.file, 0o600); } catch { /* read-only sandbox */ }
  try {
    const c = JSON.parse(readFileSync(paths.file, "utf8"));
    if (typeof c?.url === "string" && typeof c?.key === "string") return c;
  } catch { /* fall through */ }
  throw new CliError(2, `settings file is damaged: ${paths.file} — run login again`);
}

export function deleteConfig(paths) {
  rmSync(paths.file, { force: true });
  rmSync(paths.cacheDir, { recursive: true, force: true });
}
