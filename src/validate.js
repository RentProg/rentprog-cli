// src/validate.js — pre-send check against inputSchema (cli-contract §1.8); the server has the final word
import { CliError } from "./errors.js";
import { kebab } from "./flags.js";
const TYPE_OK = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

// Returns an error message or null.
function check(v, s, path) {
  if (!s || typeof s !== "object") return null;
  if (s.anyOf && !s.anyOf.some((a) => !check(v, a, path))) return `${path}: does not match any allowed form`;
  if (s.oneOf && s.oneOf.filter((a) => !check(v, a, path)).length !== 1) return `${path}: must match exactly one allowed form`;
  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => (TYPE_OK[t] ? TYPE_OK[t](v) : true))) return `${path}: expected ${types.join(" or ")}`;
  }
  if (v === null) return null;
  if (s.enum && !s.enum.includes(v)) return `${path}: one of ${s.enum.join(", ")}`;
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) return `${path}: minimum ${s.minimum}`;
    if (s.maximum !== undefined && v > s.maximum) return `${path}: maximum ${s.maximum}`;
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) return `${path}: must be greater than ${s.exclusiveMinimum}`;
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) return `${path}: at least ${s.minLength} characters`;
    if (s.maxLength !== undefined && v.length > s.maxLength) return `${path}: at most ${s.maxLength} characters`;
    if (s.pattern) { let re = null; try { re = new RegExp(s.pattern, "u"); } catch { /* server checks */ } if (re && !re.test(v)) return `${path}: must match ${s.pattern}`; }
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return `${path}: at least ${s.minItems} items`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${path}: at most ${s.maxItems} items`;
    for (let i = 0; i < v.length; i++) { const e = check(v[i], s.items, `${path}[${i}]`); if (e) return e; }
  }
  if (TYPE_OK.object(v)) return checkObject(v, s, path, []);
  return null;
}

function checkObject(v, s, path, skipRequired) {
  const props = s.properties ?? {};
  const name = (k) => (path ? `${path}.${k}` : `--${kebab(k)}`);
  for (const req of s.required ?? []) if (!skipRequired.includes(req) && v[req] === undefined) return `missing required ${name(req)}`;
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    if (props[k]) { const e = check(x, props[k], name(k)); if (e) return e; continue; }
    if (s.additionalProperties === false) return `unknown argument ${name(k)}`;
    if (s.additionalProperties && typeof s.additionalProperties === "object") { const e = check(x, s.additionalProperties, name(k)); if (e) return e; }
  }
  return null;
}

// skipRequired: service fields the CLI fills itself (idempotency_key for writes, REQ-07)
export function validateArgs(args, schema, { skipRequired = [] } = {}) {
  const e = checkObject(args, schema, "", skipRequired);
  if (e) throw new CliError(2, e);
}
