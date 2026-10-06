// src/flags.js — cli-contract §1
import { readFileSync } from "node:fs";
import { CliError } from "./errors.js";
export const RESERVED = new Set(["format", "all", "max-pages", "wait", "yes", "no-input", "args", "allow-host", "help", "idempotency-key", "preview-token"]);
export const kebab = (s) => s.replaceAll("_", "-");
const SCALARS = ["string", "integer", "number", "boolean"];
export const FORMATS = ["json", "table", "csv"];
export function checkFormat(f, source = "--format") {
  if (!FORMATS.includes(f)) throw new CliError(2, `${source}: one of ${FORMATS.join(", ")}`);
  return f;
}

// Shape of a property for the grammar: scalar | nullable (scalar + null) | array (of scalars) | json
export function shape(p = {}) {
  if (p.oneOf || p.anyOf) return { kind: "json" };
  if (Array.isArray(p.type)) {
    const other = p.type.filter((t) => t !== "null");
    if (p.type.includes("null") && other.length === 1 && SCALARS.includes(other[0])) return { kind: "nullable", type: other[0] };
    return { kind: "json" };
  }
  if (p.type === "object") return { kind: "json" };
  if (p.type === "array") {
    const it = p.items ?? { type: "string" };
    if (it.oneOf || it.anyOf || Array.isArray(it.type) || !SCALARS.includes(it.type)) return { kind: "json" };
    return { kind: "array", type: it.type, commas: !(it.type === "string" && !it.enum) };
  }
  return { kind: "scalar", type: p.type ?? "string" };
}

function scalar(name, raw, type) {
  if (type === "integer" || type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(raw) || (type === "integer" && raw.includes("."))) throw new CliError(2, `--${name}: expected ${type}, got "${raw}"`);
    return Number(raw);
  }
  if (type === "boolean") { if (raw === "true") return true; if (raw === "false") return false; throw new CliError(2, `--${name}: expected true|false`); }
  return raw;
}
function json(name, raw) { try { return JSON.parse(raw); } catch { throw new CliError(2, `--${name}: expected JSON`); } }
function readFile(path) { try { return readFileSync(path, "utf8"); } catch { throw new CliError(2, `--args: cannot read ${path}`); } }
function positive(name, raw) { const n = scalar(name, raw ?? "", "integer"); if (n < 1) throw new CliError(2, `--${name}: must be ≥ 1`); return n; }

export function parseToolArgs(argv, schema) {
  const props = schema.properties ?? {};
  const byFlag = new Map(Object.keys(props).map((k) => [kebab(k), k]));
  const cli = {}; const fromFlags = {}; let base = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) throw new CliError(2, `unexpected argument: ${tok}`);
    let name = tok.slice(2); let inline;
    if (name.includes("=")) [name, inline] = [name.slice(0, name.indexOf("=")), name.slice(name.indexOf("=") + 1)];
    const bare = () => { if (inline !== undefined) throw new CliError(2, `--${name} takes no value`); };
    const next = () => { const v = inline !== undefined ? inline : argv[++i]; if (v === undefined) throw new CliError(2, `--${name}: value required`); return v; };
    if (name === "args") {
      const v = next(); base = json("args", v.startsWith("@") ? readFile(v.slice(1)) : v);
      if (!base || typeof base !== "object" || Array.isArray(base)) throw new CliError(2, "--args: expected a JSON object");
      continue;
    }
    if (name === "format") { cli.format = checkFormat(next()); continue; }
    if (name === "all") { bare(); cli.all = true; continue; }
    if (name === "max-pages") { cli.maxPages = positive(name, next()); continue; }
    if (name === "wait") {
      if (inline !== undefined) cli.wait = positive(name, inline);
      else if (/^\d+$/.test(argv[i + 1] ?? "")) cli.wait = positive(name, argv[++i]);
      else cli.wait = true;
      continue;
    }
    if (name === "yes") { bare(); cli.yes = true; continue; }
    if (name === "no-input") { bare(); cli.noInput = true; continue; }
    if (name === "allow-host") { bare(); cli.allowHost = true; continue; }
    if (name === "help") { bare(); cli.help = true; continue; }
    if (name === "idempotency-key") { cli.idempotencyKey = next(); if (props.idempotency_key) fromFlags.idempotency_key = cli.idempotencyKey; continue; }
    if (name === "preview-token") { cli.previewToken = next(); if (props.preview_token) fromFlags.preview_token = cli.previewToken; continue; }
    let negated = false;
    if (!byFlag.has(name) && name.startsWith("no-") && byFlag.has(name.slice(3))) { negated = true; name = name.slice(3); }
    const key = byFlag.get(name);
    if (!key) throw new CliError(2, `unknown flag --${name} (see: rentprog help <tool>)`);
    const s = shape(props[key]);
    if (s.type === "boolean" && s.kind !== "array") {   // --x / --no-x; nullable boolean also --x=null
      if (negated) { if (inline !== undefined) throw new CliError(2, `--no-${name} takes no value`); fromFlags[key] = false; continue; }
      fromFlags[key] = inline === undefined ? true : s.kind === "nullable" && inline === "null" ? null : scalar(name, inline, "boolean");
      continue;
    }
    if (negated) throw new CliError(2, `--no-${name}: only for boolean flags`);
    const raw = next();
    if (s.kind === "json") { fromFlags[key] = json(name, raw); continue; }
    if (s.kind === "nullable") { fromFlags[key] = raw === "null" ? null : scalar(name, raw, s.type); continue; }
    if (s.kind === "array") {
      const parts = s.commas ? raw.split(",") : [raw];
      fromFlags[key] = [...(Array.isArray(fromFlags[key]) ? fromFlags[key] : []), ...parts.map((x) => scalar(name, x, s.type))];
      continue;
    }
    fromFlags[key] = scalar(name, raw, s.type);
  }
  return { args: { ...base, ...fromFlags }, cli };
}
