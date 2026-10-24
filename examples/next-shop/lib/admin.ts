/**
 * Demo-only "admin" gate for the privileged refund route.
 *
 * The handler's `authorize` hook refuses `/api/pay/<provider>/refund` unless the
 * `demo_admin` cookie is present. The /admin login sets that cookie after
 * comparing a form field with DEMO_ADMIN_KEY (default: 'demo-admin').
 *
 * This is intentionally weak so the example runs with zero setup. A real app
 * checks its session (role = admin) here — see the README's production notes.
 */
export const DEMO_ADMIN_COOKIE = 'demo_admin';
export const DEMO_ADMIN_VALUE = 'granted';

export function demoAdminKey(): string {
  return process.env.DEMO_ADMIN_KEY ?? 'demo-admin';
}

/** Shown on the demo login screen so the example runs without setup. */
export function demoAdminKeyHint(): string {
  return process.env.DEMO_ADMIN_KEY
    ? 'Set by DEMO_ADMIN_KEY.'
    : "Demo default key: 'demo-admin'. Set DEMO_ADMIN_KEY to change it.";
}

export function verifyDemoAdminKey(key: string): boolean {
  return key !== '' && key === demoAdminKey();
}

/** Header keys are matched case-insensitively: frameworks normalize differently */
export function hasDemoAdmin(headers: Record<string, string>): boolean {
  const cookie = Object.entries(headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1];
  if (!cookie) return false;
  return cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${DEMO_ADMIN_COOKIE}=${DEMO_ADMIN_VALUE}`);
}
