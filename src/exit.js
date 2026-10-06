// src/exit.js — cli-contract §3, first match top-down; row = table row
const UNKNOWN = [/_outcome_unknown$/, /_not_recorded$/, /_not_saved$/];
const UNKNOWN_EXACT = new Set(["telematics_command_unknown", "telematics_failed", "provider_accepted_record_failed", "provider_action_failed", "provider_failed", "marketplace_decision_failed", "interrupted_after_commit"]);
const RESTART = new Set(["stale", "preview_stale", "preview_expired", "interrupted"]);
export const UNKNOWN_OUTCOME = (c) => !!c && (UNKNOWN_EXACT.has(c) || UNKNOWN.some((r) => r.test(c)));

function view(result, fromOperationStatus) {
  const sc = result.structuredContent ?? {};
  if (fromOperationStatus) return { status: sc.status, code: sc.error_code ?? sc.error?.code, retryable: sc.error?.details?.retryable === true, isError: !!result.isError };
  if (result.isError) return { status: sc.details?.status, code: sc.error, retryable: sc.details?.retryable === true, isError: true };
  return { status: sc.status, code: undefined, retryable: false, isError: false };
}

export function exitCode(o) {
  if (o.kind === "cli") return { code: 2, row: 1 };
  if (o.kind === "transport") {
    const e = o.error;
    if (e.phase === "before_send") return { code: 4, row: 2 };
    if (e.phase === "after_send") return { code: o.write ? 5 : 4, row: 3 };
    if (e.phase === "http") {
      if (e.status === 401 || e.status === 403) return { code: 3, row: 4 };
      if (e.status === 429) return { code: 4, row: 5 };
      if (e.status >= 500) return { code: o.write ? 5 : 4, row: 6 };
      return { code: 3, row: 7 };
    }
    if (e.phase === "rpc") return e.rpcCode === -32603 ? { code: o.write ? 5 : 4, row: 8 } : { code: 3, row: 8 };
    return { code: o.write ? 5 : 4, row: 3 };
  }
  const v = view(o.result, o.fromOperationStatus);
  if (UNKNOWN_OUTCOME(v.code)) return { code: 5, row: 9 };
  if (RESTART.has(v.code) || v.status === "stale") return { code: 6, row: 10 };
  if (v.status === "failed" && v.retryable) return { code: 6, row: 11 };
  if (v.status === "failed" && o.fromOperationStatus) return { code: 5, row: 12 };
  if ((!v.status && v.retryable) || v.code === "idempotency_in_progress") return { code: 4, row: 13 };
  if (v.code === "internal") return { code: o.write ? 5 : 4, row: 14 };
  if (v.isError || ["rejected", "expired", "failed"].includes(v.status)) return { code: 3, row: 15 };   // failed outside operation_status: rolled back
  if (v.status === "previewed") {   // ответ previewed = ничего не применено, даже после подтверждения
    const sc = o.result.structuredContent ?? {};
    if (!sc.preview_token && !o.hadTokenInCall) return { code: 6, row: 16 };
    return { code: 11, row: 17 };
  }
  if (["pending_approval", "accepted", "in_progress"].includes(v.status)) return { code: 10, row: 18 };
  return { code: 0, row: 19 };
}
