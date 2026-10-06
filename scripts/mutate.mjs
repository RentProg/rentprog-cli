// scripts/mutate.mjs — each mutant breaks one rule; `npm test` must fail. Restores the file in any case.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const MUTANTS = [
  // exit codes (cli-contract §3)
  ["src/exit.js", 'if (v.status === "failed" && v.retryable) return { code: 6, row: 11 };', ""],
  ["src/exit.js", 'if (e.phase === "after_send") return { code: o.write ? 5 : 4, row: 3 };', 'if (e.phase === "after_send") return { code: 4, row: 3 };'],
  ["src/exit.js", "if ((!v.status && v.retryable) || v.code === \"idempotency_in_progress\")", "if (!v.status && (v.retryable || v.code === \"idempotency_in_progress\"))"],
  ["src/exit.js", "if ((!v.status && v.retryable) ||", "if ((false) ||"],
  ["src/client.js", 'if (e instanceof McpError && e.code === ErrorCode.RequestTimeout) return new TransportError("after_send", e.message);', ""],
  // addresses and key (CON-03)
  ["src/hosts.js", "return RENTPROG_HOSTS.has(u.hostname) || allowHost;", "return true;"],
  ["src/hosts.js", "`rpa_…${String(key).slice(-4)}`", "String(key)"],
  ["src/cli.js", "if (!foreign) { saveConfig(", "if (true) { saveConfig("],
  ["src/cli.js", "if (r.isError) return fail(io, { kind: \"result\", result: r, write: false }, toolError(r));   // not saved", "if (false) return 0;   // not saved"],
  ["src/cli.js", 'if (!key && rest.includes("--key-stdin")) key = await readStdin(io.stdin);', ""],
  ["src/config.js", "throw new CliError(2, `settings file is damaged", "return null; throw new CliError(2, `settings file is damaged"],
  ["src/config.js", "rmSync(paths.cacheDir, { recursive: true, force: true });", ""],
  // writes (REQ-07, CON-05)
  ["src/write.js", "const key = props.idempotency_key ?", "const key = true ?"],
  ["src/cli.js", 'skipRequired: write ? ["idempotency_key", "preview_token"] : []', "skipRequired: []"],
  ["src/cli.js", "if (cli.help) { io.stdout.write(helpText(tool, io.argv0)); return 0; }", ""],
  ["src/cli.js", 'if (cli.all) throw new CliError(2, "--all is only for reading tools");', ""],
  ["src/tty.js", "!!(stdin.isTTY && stdout.isTTY)", "!!stdout.isTTY"],
  ["src/write.js", "hadTokenInCall: !!call.preview_token", "hadTokenInCall: !!cli.previewToken"],
  // --wait (cli-contract §7, FM-05)
  ["src/wait.js", "await sleep(Math.min(left, pause));", "await sleep(pause);"],
  ["src/wait.js", 'return { result: null, outcome: { kind: "transport", error: e, write: false } };', "throw e;"],
  // grammar and pre-send check (CTR-04)
  ["src/flags.js", "commas: !(it.type === \"string\" && !it.enum)", "commas: true"],
  ["src/flags.js", 'fromFlags[key] = raw === "null" ? null : scalar(name, raw, s.type);', "fromFlags[key] = scalar(name, raw, s.type);"],
  ["src/flags.js", 's.kind === "nullable" && inline === "null" ? null : ', ""],
  ["src/validate.js", ".filter((a) => !check(v, a, path)).length !== 1)", ".filter((a) => !check(v, a, path)).length < 1)"],
  ["src/validate.js", "if (!types.some((t) => (TYPE_OK[t] ? TYPE_OK[t](v) : true))) return", "if (false) return"],
  ["src/validate.js", "for (let i = 0; i < v.length; i++) { const e = check(v[i], s.items, `${path}[${i}]`); if (e) return e; }", ""],
  // output, pages, cache (CTR-03, CTR-05)
  ["src/flags.js", "if (!FORMATS.includes(f)) throw", "if (false) throw"],
  ["src/output.js", "v.name ?? v.display_name", "v.display_name ?? v.name"],
  ["src/pages.js", "if (pages === 0) total = res.total ?? null;", "total = res.total ?? null;"],
  ["src/cache.js", "now - c.at < TTL_MS ? c.tools : null", "c.tools"],
  ["src/cache.js", ".update(url + key)", ".update(url)"],
  ["src/cli.js", "(!f.read || !isWrite(t))", "true"],
  // round-2 review guards
  ["src/client.js", "({ timeout: timeoutMs + 5000 })", "({})"],
  ["src/exit.js", '["rejected", "expired", "failed"]', '["rejected", "failed"]'],
  ["src/wait.js", "pause = Math.max(e.retryAfter ?? 5, 1) * 1000;", ""],
  ["src/http.js", "last.retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;", "last.retryAfter = ra;"],
  ["src/cli.js", 'if (tool.name === "operation_status" && cli.wait', 'if (false && cli.wait'],
  ["src/cli.js", "const format = f.format ? checkFormat(f.format) :", 'const format = f.format ? "json" :'],
  ["src/cli.js", "cli: { noInput: io.noInput }", "cli: {}"],
  ["src/config.js", "try { chmodSync(paths.file, 0o600); } catch", "try { } catch"],
  ["src/pages.js", 'typeof res?.has_more !== "boolean"', "false"],
  ["src/flags.js", 'if (negated) throw new CliError(2, `--no-${name}: only for boolean flags`);', ""],
  ["src/cli.js", "maxPages: cli.maxPages ?? 20", "maxPages: cli.maxPages ?? 21"],
  // round-3 review guards
  ["src/wait.js", 'const r = await within(client.callTool("operation_status", { operation_id: operationId }), deadline - Date.now());', 'const r = await client.callTool("operation_status", { operation_id: operationId });'],
  ["src/cli.js", 'interactive({ stdin: io.stdin, stdout: io.stdout, cli: { noInput: io.noInput }, env: io.env })) key = await askSecret', 'interactive({ stdin: io.stdin, stdout: io.stdout, cli: {}, env: io.env })) key = await askSecret'],
  ["src/cli.js", "if (!cmd) throw new CliError(2, USAGE(io.argv0).trim());", 'if (!cmd) { io.stderr.write(USAGE(io.argv0)); return 2; }'],
  ["src/flags.js", 'if (inline !== undefined) throw new CliError(2, `--no-${name} takes no value`); ', ""],
  // round-3 agent guards
  ["src/client.js", "const opts = sdkRequestOptions(timeoutMs);", "const opts = {};"],
  ["src/wait.js", "Math.max(e.retryAfter ?? 5, 1) * 1000", "(e.retryAfter ?? 5) * 1000"],
  ["src/cli.js", "|| s > 3600)", ")"],
  ["src/help.js", 'if (s.kind === "nullable" && s.type === "boolean")', "if (false)"],
  ["src/cli.js", 'throw new CliError(2, `tools: unknown flag', 'continue; throw new CliError(2, `tools: unknown flag'],
  ["src/cli.js", 'if (cli.wait && tool.name !== "operation_status") throw', 'if (false) throw'],
  ["src/cli.js", "const w = await waitFor(client, args.operation_id, cli.wait === true ? 120 : cli.wait, io);", "const w = await waitFor(client, args.operation_id, 120, io);"],
  ["src/cli.js", "|| s < 1 ||", "|| s <= 0 ||"],
  ["src/cli.js", "if (bare && inline !== undefined) throw", "if (false) throw"],
  ["src/write.js", "return { key, result: r.result, outcome: { kind: \"result\", result: r.result, write: true, hadTokenInCall: true } };", "return { key, result: r.result, outcome: { kind: \"result\", result: r.result, write: true, hadTokenInCall: false } };"],
  // proxy (cli-contract §7)
  ["src/http.js", "  const dispatcher = hasProxy\n", "  const dispatcher = false\n"],
  ["src/http.js", "  const dispatcher = hasProxy\n", "  const dispatcher = hasProxy && !env.NODE_USE_ENV_PROXY\n"],
  // STEP-11 code review fixes
  ["src/cli.js", "if (foreign && !isAllowedUrl(url, { allowHost: true })) throw", "if (false) throw"],
  ["src/cli.js", "if (foreign) return env.RENTPROG_API_KEY;", ""],
  ["src/flags.js", "const bare = () => { if (inline !== undefined) throw", "const bare = () => { if (false) throw"],
  ["src/hosts.js", "if (!isAllowedUrl(canonicalUrl(saved.url), {})) throw", "if (false) throw"],
  ["src/exit.js", "if (fromOperationStatus && !result.isError) return", "if (fromOperationStatus) return"],
  ["src/wait.js", "if (result.isError || !isPending(", "if (!isPending("],
  ["src/tty.js", "catch { return false; }", "catch (e) { throw e; }"],
  ["src/cli.js", ".replace(/\\brentprog (?=", ".replace(/\\bNEVER (?="],
  ["bin/rentprog.js", 'if (e.code === "EPIPE") process.exit(0);', ""],
  ["src/http.js", "noProxy: env.NO_PROXY ?? env.no_proxy", 'noProxy: ""'],
];
// A red baseline would "kill" every mutant: the suite must be green before mutating.
try { execSync("npm test", { stdio: "ignore", timeout: 180_000 }); } catch { console.log("baseline: npm test is red — fix it before mutating"); process.exit(1); }
let survived = 0;
for (const [file, from, to] of MUTANTS) {
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) { console.log(`MISSING  ${file}: ${from}`); survived++; continue; }
  writeFileSync(file, src.replace(from, to));
  let killed = false;
  try { execSync(`node --check ${file}`, { stdio: "ignore" }); } catch { writeFileSync(file, src); console.log(`SYNTAX   ${file}: ${from.slice(0, 60)}`); survived++; continue; }
  try { execSync("npm test", { stdio: "ignore", timeout: 180_000 }); } catch { killed = true; } finally { writeFileSync(file, src); }
  console.log(`${killed ? "killed  " : "SURVIVED"} ${file}: ${from.slice(0, 60)}`);
  if (!killed) survived++;
}
console.log(`${MUTANTS.length - survived}/${MUTANTS.length} killed`);
process.exit(survived ? 1 : 0);
