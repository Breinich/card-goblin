/** Authenticated read/update for one immutable named cloud project ID. */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { loadSessionEnvFromProcess, requireSession } from "@/lib/cloud/auth";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  CloudConditionalWriteError,
  describeCloudStorageFailure,
  getCloudStorage,
  type CloudStorage,
} from "@/lib/cloud/r2";
import { cloudProjectKey, isValidCloudProjectId } from "@/lib/cloud/projectIdentity";
import { verifyProjectAssetObjects } from "@/lib/cloud/projectAssetVerification";
import { parseAssetVerificationSubmissions } from "@/lib/cloud/namedProjectAsset";
import { assetsRequiringObjectVerification } from "@/lib/cloud/projectAssetReceipt";
import {
  NAMED_CLOUD_PROJECT_FORMAT_VERSION,
  parseNamedCloudProjectContent,
  parseStoredNamedCloudProjectJson,
  publicNamedCloudProject,
  serializeStoredNamedCloudProject,
  type CloudProjectRecord,
  type StoredNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

type CurrentProject =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "ok"; etag: string; project: CloudProjectRecord };

async function readCurrent(storage: CloudStorage, id: string): Promise<CurrentProject> {
  const stored = await storage.getObject(cloudProjectKey(id));
  if (stored === null) return { kind: "absent" };
  const project = parseStoredNamedCloudProjectJson(stored.bytes, id);
  return project === null
    ? { kind: "unreadable" }
    : { kind: "ok", etag: stored.etag, project };
}

type RouteContext = { params: Promise<{ projectId: string }> };

async function authorizedProjectId(
  request: NextRequest,
  context: RouteContext,
): Promise<{ response: NextResponse } | { id: string; storage: CloudStorage }> {
  const session = requireSession(request);
  if (!session.ok) return { response: json({ error: session.error }, session.status) };
  const { projectId } = await context.params;
  if (!isValidCloudProjectId(projectId)) {
    return { response: json({ error: "Invalid project ID." }, 400) };
  }
  const storage = getCloudStorage();
  if (storage === null) {
    return { response: json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503) };
  }
  return { id: projectId, storage };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authorized = await authorizedProjectId(request, context);
  if ("response" in authorized) return authorized.response;

  try {
    const current = await readCurrent(authorized.storage, authorized.id);
    if (current.kind === "absent") return json({ error: "not-found" }, 404);
    if (current.kind === "unreadable") {
      return json({ error: "Stored project is unreadable." }, 500);
    }
    return json({ project: publicNamedCloudProject(current.project) });
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function legacyCreationFingerprint(project: CloudProjectRecord): string {
  // This marks the one synthesized legacy origin; it is not a claim that old
  // name-keyed asset bytes were verified. The immutable asset migration is a
  // separate client/upload operation before a strict v2 manifest update.
  return sha256(JSON.stringify({
    id: project.id,
    name: project.name,
    code: project.code,
    sheets: project.sheets,
    assets: project.assets,
  }));
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authorized = await authorizedProjectId(request, context);
  if ("response" in authorized) return authorized.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed JSON body." }, 400);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).baseRevision !== "number" ||
    !Number.isInteger((body as Record<string, unknown>).baseRevision) ||
    ((body as Record<string, unknown>).baseRevision as number) < 1
  ) {
    return json({ error: "Malformed request." }, 400);
  }
  const bodyRecord = body as Record<string, unknown>;
  const project = parseNamedCloudProjectContent(bodyRecord.project);
  if (project === null) return json({ error: "Invalid project payload." }, 400);
  const assetVerification = parseAssetVerificationSubmissions(bodyRecord.assetVerification);
  if (assetVerification === null) return json({ error: "Malformed request." }, 400);

  let current: CurrentProject;
  try {
    current = await readCurrent(authorized.storage, authorized.id);
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
  if (current.kind === "absent") return json({ error: "not-found" }, 404);
  if (current.kind === "unreadable") {
    return json({ error: "Stored project is unreadable." }, 500);
  }
  if (bodyRecord.baseRevision !== current.project.revision) {
    return json({ error: "revision-conflict", revision: current.project.revision }, 409);
  }

  const sessionEnv = loadSessionEnvFromProcess();
  if (sessionEnv === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);
  const assetsToVerify = assetsRequiringObjectVerification(
    sessionEnv.sessionSecret,
    authorized.id,
    project.assets,
    assetVerification,
    current.project.legacy ? [] : current.project.assets,
  );
  if (assetsToVerify === null) return json({ error: "Malformed request." }, 400);

  try {
    const verification = await verifyProjectAssetObjects(
      authorized.storage,
      authorized.id,
      assetsToVerify,
    );
    if (!verification.ok) {
      return json({ error: "asset-verification-failed", assets: verification.assets }, 409);
    }
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }

  const now = new Date().toISOString();
  const updatedAt = [now, current.project.createdAt, current.project.updatedAt].sort().at(-1)!;
  const next: StoredNamedCloudProject = {
    formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
    id: current.project.id,
    name: project.name,
    createdAt: current.project.createdAt,
    updatedAt,
    ...(current.project.starterId === undefined ? {} : { starterId: current.project.starterId }),
    revision: current.project.revision + 1,
    creationTokenHash: current.project.creationTokenHash ??
      sha256(`cardgoblin:legacy:${current.project.id}:creation-token`),
    creationFingerprint: current.project.creationFingerprint ??
      legacyCreationFingerprint(current.project),
    code: project.code,
    sheets: project.sheets,
    assets: project.assets,
  };

  try {
    await authorized.storage.putObject(
      cloudProjectKey(authorized.id),
      serializeStoredNamedCloudProject(next),
      "application/json",
      current.etag,
    );
  } catch (error) {
    if (!(error instanceof CloudConditionalWriteError)) {
      return json({ error: describeCloudStorageFailure(error) }, 502);
    }
    let latestRevision = current.project.revision;
    try {
      const latest = await readCurrent(authorized.storage, authorized.id);
      if (latest.kind === "ok") latestRevision = latest.project.revision;
    } catch {
      // Best-effort conflict detail; the known revision remains actionable.
    }
    return json({ error: "revision-conflict", revision: latestRevision }, 409);
  }

  return json({ revision: next.revision, updatedAt: next.updatedAt });
}
