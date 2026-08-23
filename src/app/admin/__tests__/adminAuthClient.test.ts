import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_REQUEST_TIMEOUT_MS,
  probeAdminSession,
  signInAdmin,
  signOutAdmin,
} from "@/app/admin/_components/adminAuthClient";

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe("admin auth browser transport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("probes the no-store endpoint and distinguishes signed-in from signed-out", async () => {
    const signedInFetch = fetchReturning(
      Response.json({ authenticated: true }, { status: 200 }),
    );
    await expect(probeAdminSession(signedInFetch)).resolves.toEqual({
      ok: true,
      authenticated: true,
    });
    expect(signedInFetch).toHaveBeenCalledWith("/api/cloud/session", expect.objectContaining({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: expect.any(AbortSignal),
    }));

    const signedOutFetch = fetchReturning(
      Response.json({ authenticated: false }, { status: 401 }),
    );
    await expect(probeAdminSession(signedOutFetch)).resolves.toEqual({
      ok: true,
      authenticated: false,
    });
  });

  it("uses a fixed session-probe failure message instead of reflecting response text", async () => {
    const fetchImpl = fetchReturning(
      Response.json({ error: "secret server detail" }, { status: 503 }),
    );
    const result = await probeAdminSession(fetchImpl);
    expect(result).toEqual({
      ok: false,
      message: "Unable to check the admin session. You can still try to sign in.",
    });
    expect(JSON.stringify(result)).not.toContain("secret server detail");
  });

  it("posts credentials only to login and never reflects a failed response body", async () => {
    const fetchImpl = fetchReturning(
      Response.json({ error: "submitted-password-was..." }, { status: 401 }),
    );
    const result = await signInAdmin("private-user", "private-password", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/cloud/login", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "private-user", password: "private-password" }),
      signal: expect.any(AbortSignal),
    }));
    expect(result).toEqual({ ok: false, message: "Incorrect username or password." });
    expect(JSON.stringify(result)).not.toContain("private-user");
    expect(JSON.stringify(result)).not.toContain("private-password");
  });

  it("uses fixed unavailable messages for network/server failures", async () => {
    const rejectingFetch = vi.fn(async () => {
      throw new Error("network included secret input");
    }) as unknown as typeof fetch;
    await expect(signInAdmin("user", "password", rejectingFetch)).resolves.toEqual({
      ok: false,
      message: "Admin sign-in is unavailable. Check the server configuration and try again.",
    });

    const failedLogout = fetchReturning(new Response(null, { status: 500 }));
    await expect(signOutAdmin(failedLogout)).resolves.toEqual({
      ok: false,
      message: "Unable to sign out. Check your connection and try again.",
    });
  });

  it("signs out with a same-origin POST", async () => {
    const storageWrite = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem: storageWrite } });
    vi.stubGlobal("BroadcastChannel", class {
      postMessage = postMessage;
      close = vi.fn();
    });
    const fetchImpl = fetchReturning(Response.json({ ok: true }));
    await expect(signOutAdmin(fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/cloud/logout", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: expect.any(AbortSignal),
    }));
    expect(storageWrite).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "signed-out" });
  });

  it("does not publish a signed-out event after successful sign-in", async () => {
    const storageWrite = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem: storageWrite } });
    vi.stubGlobal("BroadcastChannel", class {
      postMessage = vi.fn();
      close = vi.fn();
    });
    await expect(signInAdmin("user", "password", fetchReturning(Response.json({ ok: true }))))
      .resolves.toEqual({ ok: true });
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("aborts a hung admin request and returns fixed retryable copy", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }));
    const pending = probeAdminSession(fetchMock as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({
      ok: false,
      message: "Unable to check the admin session. You can still try to sign in.",
    });
  });
});
