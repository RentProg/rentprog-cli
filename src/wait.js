// src/wait.js — --wait: poll operation_status (cli-contract §7), FM-05; returns {result, outcome}, result null on a transport failure
import { TransportError } from "./http.js";
const PENDING = ["pending_approval", "accepted", "in_progress"];
export const isPending = (status) => PENDING.includes(status);
const EXPIRED = Symbol("expired");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves to the promise's value, or to EXPIRED after ms; the timer never outlives the race.
function within(promise, ms) {
  let timer;
  const expiry = new Promise((r) => { timer = setTimeout(() => r(EXPIRED), Math.max(ms, 0)); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

export async function waitFor(client, operationId, seconds, io) {
  const deadline = Date.now() + seconds * 1000;
  const interval = Number(io.env.RENTPROG_WAIT_INTERVAL_MS ?? 5000);
  let result = null;
  const expired = () => {
    io.stderr.write(`still waiting; check later: ${io.argv0} operation_status --operation-id ${operationId} --wait\n`);
    const r = result ?? { structuredContent: { status: "pending_approval", operation_id: operationId } };
    return { result: r, outcome: { kind: "result", result: r, fromOperationStatus: true, waitExpired: true } };
  };
  for (;;) {
    let pause = interval;
    try {
      // a hung poll must not hold the command past the deadline (the request itself is a read, abandoning it is safe)
      const r = await within(client.callTool("operation_status", { operation_id: operationId }), deadline - Date.now());
      if (r === EXPIRED) return expired();
      result = r;
      // a tool error of operation_status (internal, not_found…) is the answer of a read: stop and report it (code by §3, internal → 4)
      if (result.isError || !isPending(result.structuredContent?.status)) return { result, outcome: { kind: "result", result, write: false, fromOperationStatus: true } };
    } catch (e) {
      // polling is a read (operation_status): a failure here does not make the write unknown — code 4, not 5
      if (!(e instanceof TransportError)) throw e;
      if (e.status !== 429) return { result: null, outcome: { kind: "transport", error: e, write: false } };
      pause = Math.max(e.retryAfter ?? 5, 1) * 1000;   // honour Retry-After (at least 1 s), but never past the deadline
    }
    const left = deadline - Date.now();
    if (left <= 0) return expired();
    await sleep(Math.min(left, pause));
  }
}
