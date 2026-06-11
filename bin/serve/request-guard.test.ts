import { describe, it, expect } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';

import { checkSameOrigin, hostnameOf } from './request-guard';

describe('hostnameOf', () => {
  it('strips the port from a host:port authority', () => {
    expect(hostnameOf('localhost:5174')).toBe('localhost');
    expect(hostnameOf('127.0.0.1:5180')).toBe('127.0.0.1');
  });
  it('returns the bare host when no port is present', () => {
    expect(hostnameOf('localhost')).toBe('localhost');
  });
  it('handles bracketed IPv6 with and without a port', () => {
    expect(hostnameOf('[::1]:5174')).toBe('[::1]');
    expect(hostnameOf('[::1]')).toBe('[::1]');
  });
  it('returns null for empty/undefined', () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf('')).toBeNull();
  });
});

describe('checkSameOrigin', () => {
  const h = (o: Partial<Record<string, string>>): IncomingHttpHeaders => o as IncomingHttpHeaders;

  it('allows a loopback request from the viewer (same-origin signals)', () => {
    expect(checkSameOrigin(h({
      host: 'localhost:5174',
      origin: 'http://localhost:5174',
      'sec-fetch-site': 'same-origin',
    }))).toEqual({ ok: true });
  });

  it('allows 127.0.0.1 + [::1] loopback hosts', () => {
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174' })).ok).toBe(true);
    expect(checkSameOrigin(h({ host: '[::1]:5174' })).ok).toBe(true);
  });

  it('allows a non-browser client (no Origin / Sec-Fetch-Site, loopback Host)', () => {
    // curl / node:http test client — fail-open on absent browser signals.
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174' })).ok).toBe(true);
  });

  it('allows a request with no headers at all (direct handler / mock)', () => {
    expect(checkSameOrigin(h({})).ok).toBe(true);
  });

  it('rejects a non-loopback Host (DNS-rebinding)', () => {
    const v = checkSameOrigin(h({ host: 'evil.attacker.com' }));
    expect(v.ok).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/non-loopback Host/);
  });

  it('rejects a cross-origin Origin even when Host is loopback (rebind + CSRF)', () => {
    const v = checkSameOrigin(h({ host: '127.0.0.1:5174', origin: 'https://evil.example' }));
    expect(v.ok).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/cross-origin Origin/);
  });

  it('rejects a cross-site Sec-Fetch-Site', () => {
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174', 'sec-fetch-site': 'cross-site' })).ok).toBe(false);
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174', 'sec-fetch-site': 'same-site' })).ok).toBe(false);
  });

  it('allows Sec-Fetch-Site none (top-level navigation / direct address bar)', () => {
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174', 'sec-fetch-site': 'none' })).ok).toBe(true);
  });

  it('rejects a malformed Origin', () => {
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174', origin: 'http://[bad' })).ok).toBe(false);
  });

  it('ignores Origin: null (treated as absent — opaque origin)', () => {
    expect(checkSameOrigin(h({ host: '127.0.0.1:5174', origin: 'null' })).ok).toBe(true);
  });
});
