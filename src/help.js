// src/help.js — REQ-03: description, arguments and how to pass them, reads / writes
import { render } from "./output.js";
import { shape, kebab, RESERVED } from "./flags.js";
const isWrite = (t) => t.annotations?.readOnlyHint === false;
const SERVICE = ["idempotency_key", "preview_token"];

function how(name, p) {
  const flag = `--${kebab(name)}`;
  if (RESERVED.has(kebab(name)) && !SERVICE.includes(name)) return `--args '{"${name}": …}'`;
  const s = shape(p);
  if (s.kind === "json") return `${flag} '<json>'`;
  if (s.kind === "nullable" && s.type === "boolean") return `${flag} | --no-${kebab(name)} | ${flag}=null`;
  if (s.kind === "nullable") return `${flag} <${s.type}> | ${flag} null`;
  if (s.kind === "array") return s.commas ? `${flag} a,b (or repeat)` : `${flag} a ${flag} b (repeat)`;
  if (s.type === "boolean") return `${flag} | --no-${kebab(name)}`;
  return `${flag} <${p.enum ? p.enum.join("|") : s.type}>`;
}

export function helpText(t, argv0 = "rentprog") {
  const req = t.inputSchema.required ?? [];
  const rows = Object.entries(t.inputSchema.properties ?? {})
    .filter(([k]) => !(isWrite(t) && SERVICE.includes(k)))
    .map(([k, p]) => ({ argument: how(k, p), required: req.includes(k) ? "yes" : "", description: (p.description ?? "").replace(/\s+/g, " ") }));
  const writeNote = isWrite(t)
    ? "\nWrites: the CLI adds an idempotency key; a preview is applied with --yes (or y/N in a terminal); --wait waits for approval.\n"
    : "";
  return `${t.name} (${isWrite(t) ? "writes" : "reads"})\n${t.description ?? ""}\n\n${rows.length ? render({ items: rows }, "table") : "(no arguments)\n"}` +
    `Any argument can also go in --args '<json object>' or --args @file.json; a flag replaces that property.\n${writeNote}` +
    `Example: ${argv0} ${t.name}${req.filter((k) => !SERVICE.includes(k)).map((k) => ` --${kebab(k)} …`).join("")}\n`;
}
