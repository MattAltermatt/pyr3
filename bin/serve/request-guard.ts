// #230 — CSRF / DNS-rebinding guard for the pyr3-serve API surface.
//
// pyr3 serve binds 127.0.0.1, but loopback binding is NOT a defense against
// either (a) a malicious page doing a cross-origin `fetch` (the API routes
// have no CORS preflight trigger — `text/plain`/simple requests reach the
// handler) or (b) DNS-rebinding (an attacker domain re-pointed at 127.0.0.1,
// so the browser sends `Host: attacker.com` to our loopback socket). Either
// lets any page the user visits drive /api/render, /api/animate (arbitrary
// out_dir write), and /api/pick-dir (native OS dialogs).
//
// The defense is a same-origin check applied to every /api route, using the
// three signals a browser attaches that a forged cross-origin request cannot
// fully spoof:
//   - Host          must resolve to a loopback hostname (defeats DNS-rebind:
//                   the rebound request carries the attacker's Host).
//   - Origin        when present, must be a loopback origin (a cross-origin
//                   fetch always sends its true Origin).
//   - Sec-Fetch-Site when present, must be same-origin / none (modern
//                   browsers stamp this; cross-site/same-site = reject).
//
// Posture: fail-CLOSED on a present-and-wrong signal, fail-OPEN on an absent
// one. Non-browser clients (curl, the node:http test client) send no Origin /
// Sec-Fetch-Site and a loopback Host, so they pass — the guard only rejects
// requests that positively look cross-origin, never legitimate same-origin
// viewer traffic or local tooling.

import type { IncomingHttpHeaders } from 'node:http';

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Extract the bare hostname from a `Host`/authority string, dropping the
 *  optional `:port`. Handles bracketed IPv6 (`[::1]:5174`). Returns null for
 *  an empty/undefined input. */
export function hostnameOf(authority: string | undefined): string | null {
  if (!authority) return null;
  const a = authority.trim();
  if (a.length === 0) return null;
  if (a.startsWith('[')) {
    const end = a.indexOf(']');
    return end >= 0 ? a.slice(0, end + 1) : a;
  }
  const colon = a.indexOf(':');
  return colon >= 0 ? a.slice(0, colon) : a;
}

function isLoopbackHost(hostname: string | null): boolean {
  return hostname !== null && LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** Decide whether an /api request is same-host (loopback) and therefore
 *  trustworthy. See the module header for the threat model.
 *
 *  #328 — this validates the loopback *host* of Host/Origin, NOT the port: a
 *  co-resident page on another loopback port passes the Origin/Host checks.
 *  That residual is covered by the stronger Sec-Fetch-Site signal for modern
 *  browsers; the port is deliberately not compared because pyr3 serve
 *  auto-bumps its bound port, so the "expected" port isn't fixed. Hence
 *  "same-host (loopback)", not literally "same-origin". */
export function checkSameOrigin(headers: IncomingHttpHeaders): GuardVerdict {
  // Host: present-and-non-loopback ⇒ reject (DNS-rebinding sends the
  // attacker's Host). Absent Host ⇒ non-browser client, allow.
  const host = headers.host;
  if (host !== undefined && !isLoopbackHost(hostnameOf(host))) {
    return { ok: false, reason: `non-loopback Host: ${host}` };
  }

  // Sec-Fetch-Site: the strongest modern signal. cross-site / same-site ⇒
  // reject. same-origin / none ⇒ allow. Absent ⇒ older client, allow.
  const secFetchSite = headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return { ok: false, reason: `cross-origin Sec-Fetch-Site: ${secFetchSite}` };
  }

  // Origin: a cross-origin fetch always carries its true Origin. Loopback
  // origin ⇒ the viewer itself. Absent ⇒ same-origin GET / non-browser, allow.
  const origin = headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    let originHost: string | null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return { ok: false, reason: `malformed Origin: ${origin}` };
    }
    if (!isLoopbackHost(originHost)) {
      return { ok: false, reason: `cross-origin Origin: ${origin}` };
    }
  }

  return { ok: true };
}
