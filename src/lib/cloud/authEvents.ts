/** Browser-only cross-tab notification. The session cookie remains the
 * authority; this event only lets already-open editors stop scheduling writes
 * immediately instead of waiting for their next 401. */

export const ADMIN_AUTH_EVENT_CHANNEL = "cardgoblin.admin-auth.v1";
export const ADMIN_AUTH_EVENT_STORAGE_KEY = "cardgoblin.admin-auth-event.v1";
export const ADMIN_SIGNED_OUT_EVENT = "signed-out";

export function publishAdminSignedOut(): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({
    type: ADMIN_SIGNED_OUT_EVENT,
    nonce: `${Date.now()}:${Math.random()}`,
  });
  try {
    window.localStorage.setItem(ADMIN_AUTH_EVENT_STORAGE_KEY, payload);
  } catch {
    // BroadcastChannel remains available in some storage-restricted contexts.
  }
  try {
    const channel = new BroadcastChannel(ADMIN_AUTH_EVENT_CHANNEL);
    channel.postMessage({ type: ADMIN_SIGNED_OUT_EVENT });
    channel.close();
  } catch {
    // A future cloud request's authoritative 401 is the fallback.
  }
}

export function isAdminSignedOutEvent(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return isAdminSignedOutEvent(JSON.parse(value));
    } catch {
      return false;
    }
  }
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).type === ADMIN_SIGNED_OUT_EVENT;
}
