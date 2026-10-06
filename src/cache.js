// src/cache.js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const TTL_MS = 60_000;
const file = (paths, url, key) => join(paths.cacheDir, `tools-${createHash("sha256").update(url + key).digest("hex").slice(0, 16)}.json`);
export function readTools(paths, url, key, now = Date.now()) {
  try { const c = JSON.parse(readFileSync(file(paths, url, key), "utf8")); return now - c.at < TTL_MS ? c.tools : null; } catch { return null; }
}
export function writeTools(paths, url, key, tools, now = Date.now()) {
  try { mkdirSync(paths.cacheDir, { recursive: true, mode: 0o700 }); writeFileSync(file(paths, url, key), JSON.stringify({ at: now, tools }), { mode: 0o600 }); } catch { /* песочница без записи — работаем без кеша */ }
}
