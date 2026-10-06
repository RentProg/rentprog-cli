// src/hosts.js
import { CliError } from "./errors.js";
export const DEFAULT_URL = "https://api.rentprog.ru/mcp";
const RENTPROG_HOSTS = new Set(["rentprog.net", "api.rentprog.ru", "api.rentprog.com", "rentprog.pro"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function canonicalUrl(str) {
  let u;
  try { u = new URL(str); } catch { throw new CliError(2, `invalid MCP address: ${str}`); }
  const path = u.pathname.replace(/\/+$/, "");
  if (path !== "/mcp") throw new CliError(2, `MCP address must end with /mcp: ${str}`);
  return `${u.protocol}//${u.host.toLowerCase()}/mcp`;
}

export function isAllowedUrl(url, { allowHost = false } = {}) {
  const u = new URL(url);
  if (LOOPBACK.has(u.hostname)) return u.protocol === "http:" || u.protocol === "https:";
  if (u.protocol !== "https:") return false;
  return RENTPROG_HOSTS.has(u.hostname) || allowHost;
}

export function resolveCredentials({ env, saved, flags }) {
  if (env.RENTPROG_API_KEY) {
    const url = canonicalUrl(env.RENTPROG_MCP_URL || DEFAULT_URL);
    if (!isAllowedUrl(url, { allowHost: flags.allowHost })) throw new CliError(2, `address not allowed: ${url} (use --allow-host to send a key from RENTPROG_API_KEY there)`);
    return { url, key: env.RENTPROG_API_KEY, source: "env" };
  }
  if (!saved) throw new CliError(2, "not connected: run `rentprog login <key> --url <address from your RentProg profile>`");
  // the saved file is local and editable: re-check the address before the key goes anywhere (cli-contract §5)
  if (!isAllowedUrl(canonicalUrl(saved.url), {})) throw new CliError(2, `saved address is not a RentProg address: ${saved.url} — run login again`);
  if (env.RENTPROG_MCP_URL && canonicalUrl(env.RENTPROG_MCP_URL) !== saved.url)
    throw new CliError(2, "RENTPROG_MCP_URL differs from the saved address; the saved key is not sent elsewhere (set RENTPROG_API_KEY too)");
  return { url: saved.url, key: saved.key, source: "config" };
}

export const maskKey = (key) => `rpa_…${String(key).slice(-4)}`;
