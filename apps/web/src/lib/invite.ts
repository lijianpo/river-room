export const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(value));
}

function validHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolvePublicAppOrigin(configuredOrigin: string | undefined, currentOrigin: string): string {
  return validHttpOrigin(configuredOrigin) ?? validHttpOrigin(currentOrigin) ?? 'http://localhost';
}

export function buildInviteUrl(code: string, origin: string): string {
  return new URL(`/invite/${encodeURIComponent(normalizeInviteCode(code))}`, `${origin.replace(/\/+$/, '')}/`).toString();
}

export function isLoopbackInviteOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === 'localhost' || hostname.startsWith('127.') || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function isSafeInviteReturnTo(value: string | null): value is string {
  return Boolean(value && /^\/invite\/[A-HJ-NP-Z2-9]{6}$/i.test(value));
}
