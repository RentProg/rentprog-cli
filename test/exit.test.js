// test/exit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCode } from "../src/exit.js";
import { CliError } from "../src/errors.js";
import { TransportError } from "../src/http.js";

const err = (code, details = {}) => ({ isError: true, structuredContent: { error: code, message: "m", details } });
const ok = (sc) => ({ structuredContent: sc });
const opst = (status, error_code, retryable) => ok({ status, error_code, error: error_code ? { code: error_code, details: retryable ? { retryable: true } : {} } : undefined });

const CASES = [
  [1, { kind: "cli", error: new CliError(2, "x") }, 2],
  [2, { kind: "transport", error: new TransportError("before_send", "x"), write: true }, 4],
  [3, { kind: "transport", error: new TransportError("after_send", "x"), write: false }, 4],
  [3, { kind: "transport", error: new TransportError("after_send", "x"), write: true }, 5],
  [4, { kind: "transport", error: new TransportError("http", "x", { status: 401 }), write: true }, 3],
  [4, { kind: "transport", error: new TransportError("http", "x", { status: 403 }), write: false }, 3],
  [5, { kind: "transport", error: new TransportError("http", "x", { status: 429, retryAfter: 7 }), write: true }, 4],
  [6, { kind: "transport", error: new TransportError("http", "x", { status: 504 }), write: false }, 4],
  [6, { kind: "transport", error: new TransportError("http", "x", { status: 502 }), write: true }, 5],
  [7, { kind: "transport", error: new TransportError("http", "x", { status: 405 }), write: false }, 3],
  [8, { kind: "transport", error: new TransportError("rpc", "x", { rpcCode: -32603 }), write: true }, 5],
  [8, { kind: "transport", error: new TransportError("rpc", "x", { rpcCode: -32603 }), write: false }, 4],
  [8, { kind: "transport", error: new TransportError("rpc", "x", { rpcCode: -32602 }), write: true }, 3],
  [9, { kind: "result", result: err("teletype_outcome_unknown", { status: "failed" }), write: true }, 5],
  [9, { kind: "result", result: err("marketplace_decision_failed"), write: true }, 5],
  [9, { kind: "result", result: opst("failed", "interrupted_after_commit"), fromOperationStatus: true }, 5],
  [10, { kind: "result", result: err("interrupted", { status: "failed" }), write: true }, 6],
  [10, { kind: "result", result: err("preview_expired"), write: true }, 6],
  [10, { kind: "result", result: ok({ status: "stale" }), write: true }, 6],
  [11, { kind: "result", result: err("telematics_unavailable", { status: "failed", retryable: true }), write: true }, 6],
  [11, { kind: "result", result: opst("failed", "x_timeout", true), fromOperationStatus: true }, 6],
  [12, { kind: "result", result: opst("failed", "some_new_code"), fromOperationStatus: true }, 5],
  [13, { kind: "result", result: err("provider_unavailable", { retryable: true }), write: true }, 4],
  [13, { kind: "result", result: err("idempotency_in_progress"), write: true }, 4],
  [13, { kind: "result", result: err("idempotency_in_progress", { status: "failed" }), write: true }, 4],
  [13, { kind: "result", result: ok({ error: { code: "busy", details: { retryable: true } } }), fromOperationStatus: true }, 4],
  [14, { kind: "result", result: err("internal"), write: true }, 5],
  [14, { kind: "result", result: err("internal"), write: false }, 4],
  [15, { kind: "result", result: err("validation_failed", { status: "failed" }), write: true }, 3],
  [15, { kind: "result", result: ok({ status: "rejected" }), fromOperationStatus: true }, 3],
  [15, { kind: "result", result: ok({ status: "expired" }), fromOperationStatus: true }, 3],
  [15, { kind: "result", result: err("not_found"), write: false }, 3],
  [16, { kind: "result", result: ok({ status: "previewed" }), write: true, hadTokenInCall: false }, 6],
  [17, { kind: "result", result: ok({ status: "previewed", preview_token: "t" }), write: true, confirmed: false }, 11],
  [18, { kind: "result", result: ok({ status: "pending_approval" }), write: true }, 10],
  [18, { kind: "result", result: ok({ status: "in_progress" }), fromOperationStatus: true, waitExpired: true }, 10],
  [19, { kind: "result", result: ok({ status: "done" }), write: true }, 0],
  [19, { kind: "result", result: ok({ status: "issued" }), write: true }, 0],
  [19, { kind: "result", result: ok({ items: [] }), write: false }, 0],
];

CASES.forEach(([row, outcome, code], i) => test(`#${i + 1}: строка ${row} → ${code}`, () => assert.deepEqual(exitCode(outcome), { code, row })));
