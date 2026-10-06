// src/client.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { makeFetch, TransportError } from "./http.js";
import { VERSION } from "./version.js";

export function normalize(e, last) {
  if (e instanceof TransportError) return e;
  if (e?.cause instanceof TransportError) return e.cause;
  if (e instanceof StreamableHTTPError || last.status >= 400)
    return new TransportError("http", e.message, { status: e.code ?? last.status, retryAfter: last.retryAfter });
  if (e instanceof McpError && e.code === ErrorCode.RequestTimeout) return new TransportError("after_send", e.message);
  if (e instanceof McpError) return new TransportError("rpc", e.message.replace(/^(MCP error -?\d+: )\1/, "$1"), { rpcCode: e.code });
  return new TransportError("after_send", e?.message ?? String(e));
}

// SDK request timer: 5 s longer than the fetch timeout, so the fetch abort (after_send) fires first;
// the SDK default (60 s) would otherwise cap RENTPROG_TIMEOUT and turn a hung write into JSON-RPC -32001.
export const sdkRequestOptions = (timeoutMs) => ({ timeout: timeoutMs + 5000 });

export async function connect({ url, key, timeoutMs = 60000, env }) {
  const opts = sdkRequestOptions(timeoutMs);
  const { fetch, last } = makeFetch({ timeoutMs, env });
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch, requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  const client = new Client({ name: "rentprog-cli", version: VERSION });
  try { await client.connect(transport, opts); } catch (e) { throw normalize(e, last); }
  const wrap = (fn) => async (...a) => { last.status = null; try { return await fn(...a); } catch (e) { throw normalize(e, last); } };
  return {
    last,
    listTools: wrap(async () => (await client.listTools(undefined, opts)).tools),
    callTool: wrap(async (name, args) => client.callTool({ name, arguments: args }, undefined, opts)),
    close: async () => client.close().catch(() => {}),
  };
}
