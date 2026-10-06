// src/output.js
import { checkFormat } from "./flags.js";
export function defaultFormat({ stdoutIsTTY, env }) {
  return env.RENTPROG_FORMAT ? checkFormat(env.RENTPROG_FORMAT, "RENTPROG_FORMAT") : stdoutIsTTY ? "table" : "json";
}
// cli-contract §2: nested object → name / display_name / id; array → element count
const cell = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? String(v.length) : String(v.name ?? v.display_name ?? v.id ?? JSON.stringify(v))) : v ?? "");
const csvCell = (v) => { const s = v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

export function render(data, format) {
  if (format === "json") return `${JSON.stringify(data, null, 2)}\n`;
  const rows = Array.isArray(data?.items) ? data.items : null;
  if (format === "csv") {
    if (!rows) return `key,value\n${Object.entries(data ?? {}).map(([k, v]) => `${csvCell(k)},${csvCell(v)}`).join("\n")}\n`;
    if (!rows.length) return "\n";
    const cols = Object.keys(rows[0]);
    return `${cols.join(",")}\n${rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n")}\n`;
  }
  if (!rows) return Object.entries(data ?? {}).map(([k, v]) => `${k}: ${cell(v)}`).join("\n") + "\n";
  if (!rows.length) return "(no rows)\n";
  const cols = Object.keys(rows[0]);
  const table = [cols, ...rows.map((r) => cols.map((c) => String(cell(r[c]))))];
  const w = cols.map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
  return table.map((r) => r.map((v, i) => String(v).padEnd(w[i])).join("  ").trimEnd()).join("\n") + "\n";
}
