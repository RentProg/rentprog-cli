// src/write.js — REQ-07: idempotency key, preview, y/N, --yes
import { randomUUID } from "node:crypto";
import { TransportError } from "./http.js";

export async function runWrite({ client, tool, args, cli, io, isInteractive, ask }) {
  const props = tool.inputSchema.properties ?? {};
  const call = { ...args };
  const key = props.idempotency_key ? (cli.idempotencyKey ?? args.idempotency_key ?? `cli-${randomUUID()}`) : null;
  if (key) { call.idempotency_key = key; io.stderr.write(`idempotency_key: ${key}\n`); }
  if (cli.previewToken && props.preview_token) call.preview_token = cli.previewToken;
  const send = async (a) => {
    try { return { result: await client.callTool(tool.name, a) }; }
    catch (e) { if (e instanceof TransportError) return { transport: e }; throw e; }
  };
  let r = await send(call);
  if (r.transport) return { key, outcome: { kind: "transport", error: r.transport, write: true } };
  const sc = r.result.structuredContent ?? {};
  if (!r.result.isError && sc.status === "previewed" && sc.preview_token) {
    let confirmed = !!cli.yes;
    if (!confirmed && isInteractive) {
      io.stderr.write(`${JSON.stringify(sc.effect ?? sc, null, 2)}\n`);
      confirmed = await ask("Apply? [y/N] ");
    }
    if (confirmed) {
      r = await send({ ...call, preview_token: sc.preview_token });
      if (r.transport) return { key, outcome: { kind: "transport", error: r.transport, write: true } };
      return { key, result: r.result, outcome: { kind: "result", result: r.result, write: true, hadTokenInCall: true } };
    }
    io.stderr.write(`Preview only — nothing applied. To apply, repeat the same command with the same arguments plus:\n  --idempotency-key ${key} --preview-token ${sc.preview_token}\n`);
  }
  return { key, result: r.result, outcome: { kind: "result", result: r.result, write: true, hadTokenInCall: !!call.preview_token } };
}
