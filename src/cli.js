// src/cli.js — commands: login, logout, whoami, tools, help, <tool>
import { VERSION } from "./version.js";
import { CliError } from "./errors.js";
import { TransportError } from "./http.js";
import { configPaths, loadConfig, saveConfig, deleteConfig } from "./config.js";
import { resolveCredentials, canonicalUrl, isAllowedUrl, DEFAULT_URL, maskKey } from "./hosts.js";
import { connect } from "./client.js";
import { readTools, writeTools } from "./cache.js";
import { parseToolArgs, checkFormat } from "./flags.js";
import { validateArgs } from "./validate.js";
import { render, defaultFormat } from "./output.js";
import { fetchAll } from "./pages.js";
import { exitCode } from "./exit.js";
import { runWrite } from "./write.js";
import { waitFor, isPending } from "./wait.js";
import { helpText } from "./help.js";
import { interactive, ask, askSecret } from "./tty.js";

const isWrite = (t) => t.annotations?.readOnlyHint === false;
function timeoutMs(env) {
  const s = Number(env.RENTPROG_TIMEOUT ?? 60);
  if (!Number.isFinite(s) || s < 1 || s > 3600) throw new CliError(2, "RENTPROG_TIMEOUT: seconds, from 1 to 3600");
  return s * 1000;
}
const USAGE = (a) => `usage: ${a} login <key> [--url <address>] | logout | whoami | tools [--read|--write] [--grep <text>] | help <tool> | <tool> [flags]\n`;

// Error to stderr: text in a terminal, JSON {error, message, details, exit_code} otherwise (cli-contract §2)
function fail(io, outcome, payload) {
  const { code } = exitCode(outcome);
  const tty = interactive({ stdin: io.stdin, stdout: io.stdout, cli: { noInput: io.noInput }, env: io.env });
  // hints from other modules say `rentprog …`; repeat the way the CLI was started (REQ-01: npx or the installed command)
  payload = { ...payload, message: String(payload.message ?? "").replace(/\brentprog (?=(login|help|tools|whoami|operation_status)\b)/g, `${io.argv0} `) };
  io.stderr.write(tty ? `${payload.message}\n` : `${JSON.stringify({ error: payload.error ?? "error", message: payload.message, details: payload.details ?? {}, exit_code: code })}\n`);
  return code;
}
const toolError = (r) => ({ error: r.structuredContent?.error ?? "tool_error", message: r.structuredContent?.message ?? r.content?.[0]?.text ?? "tool error", details: r.structuredContent?.details ?? {} });
function flagValue(rest, flag) {
  const i = rest.indexOf(flag);
  if (i < 0) return undefined;
  const v = rest[i + 1];
  if (v === undefined || v.startsWith("--")) throw new CliError(2, `${flag}: value required`);
  return v;
}
const readStdin = (stdin) => new Promise((r) => { let b = ""; stdin.setEncoding?.("utf8"); stdin.on("data", (c) => (b += c)); stdin.on("end", () => r(b.trim())); });

// The key login checks: on a foreign host (--allow-host) only RENTPROG_API_KEY, never a positional key (cli-contract §5)
export function loginKey({ foreign, rest, env }) {
  if (foreign) return env.RENTPROG_API_KEY;
  return rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
}

async function login(rest, io, paths) {
  const url = canonicalUrl(flagValue(rest, "--url") ?? DEFAULT_URL);
  // Foreign host: only with --allow-host and the key from RENTPROG_API_KEY; checked, never saved (cli-contract §5)
  const foreign = !isAllowedUrl(url, {});
  if (foreign && !(rest.includes("--allow-host") && io.env.RENTPROG_API_KEY))
    throw new CliError(2, `address not allowed: ${url} (only RentProg addresses; for another host use RENTPROG_API_KEY with --allow-host, nothing is saved)`);
  if (foreign && !isAllowedUrl(url, { allowHost: true })) throw new CliError(2, `address not allowed: ${url} (another host only over https)`);
  let key = loginKey({ foreign, rest, env: io.env });
  if (!key && rest.includes("--key-stdin")) key = await readStdin(io.stdin);
  if (!key && interactive({ stdin: io.stdin, stdout: io.stdout, cli: { noInput: io.noInput }, env: io.env })) key = await askSecret("RentProg key (rpa_…): ", io);
  if (!key) throw new CliError(2, `key required: ${io.argv0} login <key> --url <address from your RentProg profile>`);
  const client = await connect({ url, key, timeoutMs: timeoutMs(io.env), env: io.env });
  try {
    const list = await client.listTools();
    const hasWhoami = list.some((t) => t.name === "whoami");
    let who = null;
    if (hasWhoami) {
      const r = await client.callTool("whoami", {});
      if (r.isError) return fail(io, { kind: "result", result: r, write: false }, toolError(r));   // not saved (EC-01)
      who = r.structuredContent ?? {};
    }
    if (!foreign) { saveConfig(paths, { url, key }); writeTools(paths, url, key, list); }
    const saved = foreign ? " — not saved (foreign host)" : "";
    io.stderr.write(who
      ? `Connected: ${who.user?.name ?? "?"} (${maskKey(key)})${saved}\nLevels: ${JSON.stringify(who.levels ?? {})}\nNext: ${io.argv0} tools\n`
      : `Connected (${maskKey(key)})${saved}: key of the previous format — read-only, ${list.length} tools. Reissue it in your RentProg profile to get the full catalog.\n`);
    return 0;
  } finally { await client.close(); }
}

async function toolList(client, paths, creds) {
  const cached = readTools(paths, creds.url, creds.key);
  if (cached) return cached;
  const list = await client.listTools();
  writeTools(paths, creds.url, creds.key, list);
  return list;
}

// Flags of `tools`: --read, --write, --grep <text>, --format <f> (also --grep=… / --format=…); anything else — code 2
function toolsFlags(rest) {
  const f = {};
  for (let i = 0; i < rest.length; i++) {
    const [name, inline] = rest[i].includes("=") ? [rest[i].slice(0, rest[i].indexOf("=")), rest[i].slice(rest[i].indexOf("=") + 1)] : [rest[i], undefined];
    const bare = ["--read", "--write", "--allow-host", "--no-input"].includes(name);
    if (bare && inline !== undefined) throw new CliError(2, `${name} takes no value`);
    if (name === "--read" || name === "--write") { f[name.slice(2)] = true; continue; }
    if (bare) continue;
    if (name === "--grep" || name === "--format") {
      const v = inline ?? rest[++i];
      if (v === undefined || v.startsWith("--")) throw new CliError(2, `${name}: value required`);
      f[name.slice(2)] = v;
      continue;
    }
    throw new CliError(2, `tools: unknown flag ${rest[i]} (--read, --write, --grep <text>, --format <json|table|csv>)`);
  }
  return f;
}

function listTools(list, rest, io) {
  const f = toolsFlags(rest);
  const grep = f.grep?.toLowerCase();
  const format = f.format ? checkFormat(f.format) : defaultFormat({ stdoutIsTTY: io.stdout.isTTY, env: io.env });
  const rows = list
    .filter((t) => (!f.read || !isWrite(t)) && (!f.write || isWrite(t)))
    .filter((t) => !grep || `${t.name} ${t.description ?? ""}`.toLowerCase().includes(grep))
    .map((t) => ({ name: t.name, kind: isWrite(t) ? "write" : "read", description: (t.description ?? "").split(/(?<=\.)\s/)[0] }));
  io.stdout.write(render({ items: rows }, format));
  return 0;
}

async function callRead(client, tool, args, cli, format, io) {
  if (cli.wait && tool.name !== "operation_status") throw new CliError(2, "--wait is for writes and operation_status");
  if (cli.all) {
    const env = await fetchAll(async (page) => {
      const r = await client.callTool(tool.name, { ...args, page });
      if (r.isError) throw Object.assign(new Error("tool error"), { result: r });
      return r.structuredContent;
    }, { schema: tool.inputSchema, maxPages: cli.maxPages ?? 20 });
    if (env.truncated) io.stderr.write(`warning: stopped at --max-pages ${env.pages}; more pages exist\n`);
    io.stdout.write(render(env, format));
    return 0;
  }
  let r, outcome;
  if (tool.name === "operation_status" && cli.wait) {
    // poll the same operation, every request within the deadline (never re-run the write — that would be a second operation)
    const w = await waitFor(client, args.operation_id, cli.wait === true ? 120 : cli.wait, io);
    if (w.outcome.kind === "transport") {
      const e = w.outcome.error;
      return fail(io, w.outcome, { error: "transport", message: `${e.message} while waiting; check again: ${io.argv0} operation_status --operation-id ${args.operation_id} --wait`, details: { status: e.status ?? null, operation_id: args.operation_id } });
    }
    ({ result: r, outcome } = w);
  } else {
    r = await client.callTool(tool.name, args);
    outcome = { kind: "result", result: r, write: false, fromOperationStatus: tool.name === "operation_status" };
  }
  if (r.isError) return fail(io, outcome, toolError(r));
  io.stdout.write(render(r.structuredContent ?? {}, format));
  return exitCode(outcome).code;
}

async function callWrite(client, tool, args, cli, format, io) {
  if (cli.all) throw new CliError(2, "--all is only for reading tools");
  const isInteractive = interactive({ stdin: io.stdin, stdout: io.stdout, cli, env: io.env });
  const w = await runWrite({ client, tool, args, cli, io, isInteractive, ask: (q) => ask(q, io) });
  if (w.outcome.kind === "transport") {
    const e = w.outcome.error;
    const repeat = exitCode(w.outcome).code === 5 && w.key ? ` Check the result (${io.argv0} operation_status / the record) and repeat only with --idempotency-key ${w.key}.` : "";
    return fail(io, w.outcome, { error: "transport", message: `${e.message}.${repeat}`, details: { status: e.status ?? null, retry_after: e.retryAfter ?? null, idempotency_key: w.key } });
  }
  let final = w;
  const sc = w.result.structuredContent ?? {};
  if (cli.wait && !w.result.isError && isPending(sc.status) && sc.operation_id) final = await waitFor(client, sc.operation_id, cli.wait === true ? 120 : cli.wait, io);
  else if (!w.result.isError && isPending(sc.status)) io.stderr.write(`Operation ${sc.operation_id ?? ""} is ${sc.status}. Wait for it (do not rerun the write): ${io.argv0} operation_status --operation-id ${sc.operation_id ?? "…"} --wait\n`);
  if (final.outcome.kind === "transport") {
    const e = final.outcome.error;
    return fail(io, final.outcome, { error: "transport", message: `${e.message} while waiting; the write was accepted — check: ${io.argv0} operation_status --operation-id ${sc.operation_id}`, details: { status: e.status ?? null, operation_id: sc.operation_id } });
  }
  if (final.result.isError) {
    const e = toolError(final.result);
    return fail(io, final.outcome, final === w ? e : { ...e, message: `${e.message} (while waiting; the write was accepted — check: ${io.argv0} operation_status --operation-id ${sc.operation_id} --wait)`, details: { ...e.details, operation_id: sc.operation_id } });
  }
  io.stdout.write(render(final.result.structuredContent ?? {}, format));
  return exitCode(final.outcome).code;
}

export async function main(argv, io) {
  const paths = io.paths ?? configPaths(io.env);
  const [cmd, ...rest] = argv;
  io = { ...io, noInput: argv.includes("--no-input") };
  let write = false;
  try {
    if (cmd === "--version" || cmd === "-v") { io.stdout.write(`${VERSION}\n`); return 0; }
    if (cmd === "--help" || cmd === "-h") { io.stdout.write(USAGE(io.argv0)); return 0; }
    if (!cmd) throw new CliError(2, USAGE(io.argv0).trim());
    if (cmd === "logout") { deleteConfig(paths); io.stderr.write("Logged out: saved key and cache removed.\n"); return 0; }
    if (cmd === "login") return await login(rest, io, paths);
    if (cmd === "help" && !rest[0]) throw new CliError(2, USAGE(io.argv0).trim());
    const creds = resolveCredentials({ env: io.env, saved: io.env.RENTPROG_API_KEY ? null : loadConfig(paths), flags: { allowHost: rest.includes("--allow-host") } });
    const client = await connect({ url: creds.url, key: creds.key, timeoutMs: timeoutMs(io.env), env: io.env });
    try {
      const list = await toolList(client, paths, creds);
      if (cmd === "tools") return listTools(list, rest, io);
      if (cmd === "help") {
        const t = list.find((x) => x.name === rest[0]);
        if (!t) throw new CliError(2, `no tool "${rest[0] ?? ""}" for this key (see: ${io.argv0} tools)`);
        io.stdout.write(helpText(t, io.argv0));
        return 0;
      }
      const tool = list.find((x) => x.name === cmd);
      if (!tool) throw new CliError(2, `no tool "${cmd}" for this key (see: ${io.argv0} tools)`);
      write = isWrite(tool);
      const { args, cli } = parseToolArgs(rest, tool.inputSchema);
      if (cli.help) { io.stdout.write(helpText(tool, io.argv0)); return 0; }   // --help never calls the tool
      validateArgs(args, tool.inputSchema, { skipRequired: write ? ["idempotency_key", "preview_token"] : [] });
      const format = cli.format ?? defaultFormat({ stdoutIsTTY: io.stdout.isTTY, env: io.env });
      return write ? await callWrite(client, tool, args, cli, format, io) : await callRead(client, tool, args, cli, format, io);
    } finally { await client.close(); }
  } catch (e) {
    if (e instanceof CliError) return fail(io, { kind: "cli", error: e }, { error: "cli", message: e.message, details: e.details });
    if (e instanceof TransportError) return fail(io, { kind: "transport", error: e, write }, { error: "transport", message: e.message, details: { status: e.status ?? null, retry_after: e.retryAfter ?? null } });
    if (e?.result) return fail(io, { kind: "result", result: e.result, write: false }, toolError(e.result));
    throw e;
  }
}
