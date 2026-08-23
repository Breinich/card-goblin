/**
 * GET /api/cloud/session — the deliberately tiny browser-facing auth probe.
 *
 * The editor and /admin need to know whether the host-only HttpOnly session
 * cookie is valid, but must never receive the cookie itself, the configured
 * username, or requireSession's diagnostic text. Authentication remains a
 * server-side decision: this route reuses the same guard as every protected
 * cloud endpoint and returns only an authenticated boolean.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

export function GET(request: NextRequest): NextResponse {
  const session = requireSession(request);
  if (!session.ok) {
    // Keep requireSession's status distinction (401 means sign in; 503 means
    // the deployment cannot evaluate auth), without exposing its operational
    // diagnostic through this public probe.
    return NextResponse.json(
      { authenticated: false },
      { status: session.status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { authenticated: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
