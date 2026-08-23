/** Authenticated conditional-create presign for one named project's asset. */

import { NextResponse, type NextRequest } from "next/server";
import { loadSessionEnvFromProcess, requireSession } from "@/lib/cloud/auth";
import { PRESIGN_GET_TTL_SECONDS, PRESIGN_PUT_TTL_SECONDS } from "@/lib/cloud/keys";
import {
  LEGACY_CLOUD_PROJECT_ID,
  cloudAssetKey,
  cloudProjectKey,
  isValidCloudProjectId,
} from "@/lib/cloud/projectIdentity";
import {
  parseProspectiveCloudAsset,
  storedObjectMatchesImmutableAsset,
} from "@/lib/cloud/namedProjectAsset";
import { createProjectAssetVerificationReceipt } from "@/lib/cloud/projectAssetReceipt";
import { parseStoredNamedCloudProjectJson } from "@/lib/cloud/namedProjectPayload";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  describeCloudStorageFailure,
  getCloudStorage,
  type CloudStorage,
} from "@/lib/cloud/r2";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

const json = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

type RouteContext = { params: Promise<{ projectId: string }> };

async function projectManifestState(storage: CloudStorage, projectId: string): Promise<"ok" | "missing" | "unreadable"> {
  const stored = await storage.getObject(cloudProjectKey(projectId));
  if (stored === null) return "missing";
  return parseStoredNamedCloudProjectJson(stored.bytes, projectId) === null ? "unreadable" : "ok";
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return json({ error: session.error }, session.status);
  const sessionEnv = loadSessionEnvFromProcess();
  if (sessionEnv === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);
  const { projectId } = await context.params;
  if (!isValidCloudProjectId(projectId)) return json({ error: "Invalid project ID." }, 400);

  const storage = getCloudStorage();
  if (storage === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed JSON body." }, 400);
  }
  const asset = parseProspectiveCloudAsset(body);
  if (asset === null) return json({ error: "Invalid asset request." }, 400);

  try {
    // An absent manifest is the expected first-creation staging state. The
    // UUID-scoped bytes remain invisible to listing/GET until POST /projects
    // verifies them and conditionally publishes revision 1. If a manifest is
    // already present, it must still be readable for this exact UUID.
    const project = await projectManifestState(storage, projectId);
    if (project === "unreadable") return json({ error: "Stored project is unreadable." }, 500);
    // UUID projects may stage bytes before their manifest is conditionally
    // created. `default` is reserved for the deployed legacy slot, so never
    // let this route manufacture a new default project from orphan bytes.
    if (projectId === LEGACY_CLOUD_PROJECT_ID && project === "missing") {
      return json({ error: "not-found" }, 404);
    }

    const key = cloudAssetKey(projectId, asset.hash);
    const existing = await storage.getObject(key);
    if (existing !== null) {
      if (!storedObjectMatchesImmutableAsset(existing, asset)) {
        return json({ error: "immutable-asset-conflict" }, 409);
      }
      const verifyUrl = await storage.presignGet(key, PRESIGN_GET_TTL_SECONDS);
      const verificationReceipt = createProjectAssetVerificationReceipt(
        sessionEnv.sessionSecret,
        projectId,
        asset,
      );
      return json({ url: null, alreadyPresent: true, verifyUrl, verificationReceipt });
    }

    const url = await storage.presignPut(
      key,
      asset.mime,
      asset.size,
      PRESIGN_PUT_TTL_SECONDS,
      { onlyIfAbsent: true },
    );
    return json({ url, alreadyPresent: false, verifyUrl: null, verificationReceipt: null });
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
}
