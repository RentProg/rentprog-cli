// scripts/stand-smoke.mjs — CHK-02: the CLI against a real API (bin/e2e-stand, API :3300).
// RENTPROG_API_KEY — a stand key with level ≥ preview for clients. Checks content, not only exit codes.
import { execFileSync } from "node:child_process";
const URL_ = process.env.RENTPROG_MCP_URL ?? "http://localhost:3300/mcp";
const once = (args) => {
  try { return { code: 0, out: execFileSync(process.execPath, ["bin/rentprog.js", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RENTPROG_MCP_URL: URL_ } }), err: "" }; }
  catch (e) { return { code: e.status, out: e.stdout ?? "", err: e.stderr ?? "" }; }
};
// The server limits reads per key per minute (CON-04): on 429 wait Retry-After once and repeat.
const run = (args) => {
  const r = once(args);
  const ra = r.code === 4 && /"status":429/.test(r.err) ? Number(JSON.parse(r.err).details.retry_after ?? 60) : 0;
  if (!ra) return r;
  console.log(`  rate limited, waiting ${ra} s`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ra * 1000);
  return once(args);
};
const json = (s) => JSON.parse(s);
let clientId = null;
const CASES = [
  [["whoami"], 0, (r) => json(r.out).user],
  [["tools", "--read"], 0, (r) => json(r.out).items.some((t) => t.name === "list_bookings")],
  [["help", "list_bookings"], 0, (r) => r.out.includes("--per-page")],
  [["company_reference"], 0, (r) => Array.isArray(json(r.out).branches)],
  [["list_bookings", "--all", "--per-page", "50", "--max-pages", "3"], 0, (r) => { const e = json(r.out); return e.pages >= 1 && e.count === e.items.length; }],
  [["crm_leads"], 0, (r) => typeof json(r.out) === "object"],
  [["cashboxes"], 0, (r) => typeof json(r.out) === "object"],
  [["list_employees", "--format", "csv"], 0, (r) => r.out.split("\n")[0].includes(",")],
  [["search_clients", "--created-from", "2000-01-01", "--per-page", "1"], 0, (r) => { clientId = json(r.out).items[0]?.id; return !!clientId; }],
  // write on the preview level: nothing applied, code 11, continuation hint with key and token
  [() => ["update_client", "--client-id", String(clientId), "--dop-info", "ft189 stand smoke"], 11, (r) => /--idempotency-key \S+ --preview-token \S+/.test(r.err)],
  [["list_bookings", "--per-page", "abc"], 2, (r) => json(r.err).exit_code === 2],
];
// Tools absent from this key's catalog (e.g. CRM on a tenant without it) are reported as skip, not as a failure.
const catalog = new Set(json(run(["tools", "--format", "json"]).out).items.map((t) => t.name));
const COMMANDS = new Set(["whoami", "tools", "help"]);
let bad = 0;
for (const [a, expected, check] of CASES) {
  const args = typeof a === "function" ? a() : a;
  if (!COMMANDS.has(args[0]) && !catalog.has(args[0])) { console.log(`skip ${args.join(" ").padEnd(60)} (not in this key's catalog)`); continue; }
  const r = run(args);
  let ok = r.code === expected;
  try { ok = ok && !!check(r); } catch { ok = false; }
  console.log(`${ok ? "ok  " : "FAIL"} ${args.join(" ").padEnd(60)} code=${r.code} (want ${expected}) bytes=${r.out.length}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
