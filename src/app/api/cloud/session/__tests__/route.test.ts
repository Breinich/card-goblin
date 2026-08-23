import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cloud/session/route";
import { SESSION_COOKIE_NAME } from "@/lib/cloud/auth";
import { createSessionCookieValue } from "@/lib/cloud/session";

const SESSION_SECRET = "session-route-test-secret-with-32-bytes";
const originalSessionSecret = process.env.SESSION_SECRET;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;

function request(cookie?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cloud/session", {
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  // requireSession only needs auth to be configured; hash parsing remains
  // the login route's responsibility and is deliberately not repeated here.
  process.env.ADMIN_PASSWORD_HASH = "configured-for-session-probe";
});

afterAll(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  else process.env.ADMIN_PASSWORD_HASH = originalPasswordHash;
});

describe("GET /api/cloud/session", () => {
  it("returns only minimal authenticated state for a valid session", async () => {
    const cookie = createSessionCookieValue(SESSION_SECRET);
    const response = GET(request(`${SESSION_COOKIE_NAME}=${cookie}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("returns a minimal 401 for a missing, invalid, or expired session", async () => {
    const expired = createSessionCookieValue(SESSION_SECRET, Date.now() - 365 * 24 * 60 * 60 * 1000);
    const requests = [
      request(),
      request(`${SESSION_COOKIE_NAME}=tampered`),
      request(`${SESSION_COOKIE_NAME}=${expired}`),
    ];

    for (const candidate of requests) {
      const response = GET(candidate);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ authenticated: false });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("preserves requireSession's safe 503 posture when auth cannot be evaluated", async () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD_HASH;

    const response = GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
