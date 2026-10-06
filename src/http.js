// src/http.js
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

export class TransportError extends Error {
  constructor(phase, message, extra = {}) { super(message); this.phase = phase; Object.assign(this, extra); }
}
const BEFORE_SEND = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"]);

export function makeFetch({ timeoutMs = 60000, env = process.env } = {}) {
  const hasProxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  const dispatcher = hasProxy && !env.NODE_USE_ENV_PROXY
    ? new EnvHttpProxyAgent({ httpProxy: env.HTTP_PROXY || env.http_proxy, httpsProxy: env.HTTPS_PROXY || env.https_proxy, noProxy: env.NO_PROXY ?? env.no_proxy })
    : undefined;
  const last = { status: null, retryAfter: null };
  const fetchImpl = async (input, init = {}) => {
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]);
    let res;
    try {
      res = await undiciFetch(input, { ...init, signal, ...(dispatcher ? { dispatcher } : {}) });
    } catch (e) {
      const code = e?.cause?.code;
      throw new TransportError(BEFORE_SEND.has(code) ? "before_send" : "after_send", `network error: ${code || e.name}`, { cause: e });
    }
    last.status = res.status;
    const ra = Number(res.headers.get("retry-after") ?? NaN);   // seconds; an HTTP date (from a proxy) → null, callers default
    last.retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;
    return res;
  };
  return { fetch: fetchImpl, last };
}
