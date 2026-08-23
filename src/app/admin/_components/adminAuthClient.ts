/** Store-free browser transport for /admin. */

import { publishAdminSignedOut } from "@/lib/cloud/authEvents";

export type AdminSessionResult =
  | { ok: true; authenticated: boolean }
  | { ok: false; message: string };

export type AdminMutationResult = { ok: true } | { ok: false; message: string };

type FetchLike = typeof fetch;
export const ADMIN_REQUEST_TIMEOUT_MS = 15_000;

async function fetchAdmin(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("admin request timed out"));
    }, ADMIN_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (!timedOut && timeoutId !== null) clearTimeout(timeoutId);
  }
}

const SESSION_UNAVAILABLE_MESSAGE =
  "Unable to check the admin session. You can still try to sign in.";
const SIGN_IN_FAILURE_MESSAGE = "Incorrect username or password.";
const SIGN_IN_UNAVAILABLE_MESSAGE =
  "Admin sign-in is unavailable. Check the server configuration and try again.";
const SIGN_OUT_FAILURE_MESSAGE =
  "Unable to sign out. Check your connection and try again.";

/**
 * Fixed messages are intentional. This client never reflects an arbitrary
 * response body into the page, where a proxy/server failure could otherwise
 * expose operational details or submitted credentials.
 */
export async function probeAdminSession(
  fetchImpl: FetchLike = fetch,
): Promise<AdminSessionResult> {
  try {
    const response = await fetchAdmin(fetchImpl, "/api/cloud/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 200) return { ok: true, authenticated: true };
    if (response.status === 401) return { ok: true, authenticated: false };
    return { ok: false, message: SESSION_UNAVAILABLE_MESSAGE };
  } catch {
    return { ok: false, message: SESSION_UNAVAILABLE_MESSAGE };
  }
}

export async function signInAdmin(
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminMutationResult> {
  try {
    const response = await fetchAdmin(fetchImpl, "/api/cloud/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, message: SIGN_IN_FAILURE_MESSAGE };
    }
    return { ok: false, message: SIGN_IN_UNAVAILABLE_MESSAGE };
  } catch {
    return { ok: false, message: SIGN_IN_UNAVAILABLE_MESSAGE };
  }
}

export async function signOutAdmin(
  fetchImpl: FetchLike = fetch,
): Promise<AdminMutationResult> {
  try {
    const response = await fetchAdmin(fetchImpl, "/api/cloud/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      publishAdminSignedOut();
      return { ok: true };
    }
    return { ok: false, message: SIGN_OUT_FAILURE_MESSAGE };
  } catch {
    return { ok: false, message: SIGN_OUT_FAILURE_MESSAGE };
  }
}
