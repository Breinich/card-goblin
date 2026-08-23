/** Authenticated verified GET presign for one referenced immutable asset. */

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";
import { PRESIGN_GET_TTL_SECONDS } from "@/lib/cloud/keys";
import {
  SHA256_HEX_PATTERN,
  cloudAssetKey,
  cloudProjectKey,
  isValidCloudProjectId,
} from "@/lib/cloud/projectIdentity";
import { storedObjectMatchesImmutableAsset } from "@/lib/cloud/namedProjectAsset";
import { parseStoredNamedCloudProjectJson } from "@/lib/cloud/namedProjectPayload";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  describeCloudStorageFailure,
  getCloudStorage,
} from "@/lib/cloud/r2";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

const json = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

type RouteContext = { params: Promise<{ projectId: string; hash: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return json({ error: session.error }, session.status);
  const { projectId, hash } = await context.params;
  if (!isValidCloudProjectId(projectId)) return json({ error: "Invalid project ID." }, 400);
  if (!SHA256_HEX_PATTERN.test(hash)) return json({ error: "Invalid asset hash." }, 400);

  const storage = getCloudStorage();
  if (storage === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);

  try {
    const manifestObject = await storage.getObject(cloudProjectKey(projectId));
    if (manifestObject === null) return json({ error: "not-found" }, 404);
    const project = parseStoredNamedCloudProjectJson(manifestObject.bytes, projectId);
    if (project === null) return json({ error: "Stored project is unreadable." }, 500);

    const references = project.assets.filter((asset) => asset.hash === hash);
    if (references.length === 0) return json({ error: "asset-not-found" }, 404);
    const expected = references[0];
    if (references.some((entry) => entry.mime !== expected.mime || entry.size !== expected.size)) {
      return json({ error: "immutable-asset-conflict" }, 409);
    }

    const key = cloudAssetKey(projectId, hash);
    const stored = await storage.getObject(key);
    if (stored === null) return json({ error: "asset-not-found" }, 404);
    if (!storedObjectMatchesImmutableAsset(stored, expected)) {
      return json({ error: "immutable-asset-conflict" }, 409);
    }

    const url = await storage.presignGet(key, PRESIGN_GET_TTL_SECONDS);
    return json({ url });
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
}
