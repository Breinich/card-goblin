/** Authenticated named-project collection: complete listing + idempotent create. */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/cloud/auth";
import {
  CLOUD_UNCONFIGURED_MESSAGE,
  CloudConditionalWriteError,
  CloudStorageError,
  describeCloudStorageFailure,
  getCloudStorage,
  type CloudStorage,
} from "@/lib/cloud/r2";
import {
  CLOUD_PROJECTS_PREFIX,
  cloudProjectKey,
  isValidCloudProjectId,
  isValidNewCloudProjectId,
} from "@/lib/cloud/projectIdentity";
import {
  NAMED_CLOUD_PROJECT_FORMAT_VERSION,
  namedCloudProjectSummary,
  parseNamedCloudProjectContent,
  parseStoredNamedCloudProjectJson,
  publicNamedCloudProject,
  serializeStoredNamedCloudProject,
  type CloudProjectRecord,
  type NamedCloudProjectSummary,
  type StoredNamedCloudProject,
  type UnreadableCloudProjectSummary,
} from "@/lib/cloud/namedProjectPayload";
import { verifyProjectAssetObjects } from "@/lib/cloud/projectAssetVerification";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;
const CREATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,200}$/;
const LIST_PAGE_SIZE = 1000;
const MANIFEST_READ_CONCURRENCY = 16;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Canonical JSON makes retries independent of object insertion order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${pairs.join(",")}}`;
  }
  throw new Error("Cannot fingerprint a non-JSON value.");
}

async function listProjectIds(storage: CloudStorage): Promise<string[]> {
  const ids = new Set<string>();
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const page = await storage.listPage({
      prefix: CLOUD_PROJECTS_PREFIX,
      delimiter: "/",
      continuationToken,
      maxKeys: LIST_PAGE_SIZE,
    });
    for (const prefix of page.commonPrefixes) {
      if (!prefix.startsWith(CLOUD_PROJECTS_PREFIX) || !prefix.endsWith("/")) continue;
      const id = prefix.slice(CLOUD_PROJECTS_PREFIX.length, -1);
      if (isValidCloudProjectId(id)) ids.add(id);
    }
    if (page.nextContinuationToken === null) break;
    if (seenTokens.has(page.nextContinuationToken)) {
      throw new CloudStorageError("R2 LIST repeated a continuation token", {
        operation: "LIST",
        status: 200,
        code: "RepeatedContinuationToken",
      });
    }
    seenTokens.add(page.nextContinuationToken);
    continuationToken = page.nextContinuationToken;
  } while (true);
  return [...ids];
}

async function readListEntries(
  storage: CloudStorage,
  ids: string[],
): Promise<Array<NamedCloudProjectSummary | UnreadableCloudProjectSummary>> {
  const entries: Array<NamedCloudProjectSummary | UnreadableCloudProjectSummary> = [];
  for (let offset = 0; offset < ids.length; offset += MANIFEST_READ_CONCURRENCY) {
    const batch = ids.slice(offset, offset + MANIFEST_READ_CONCURRENCY);
    const resolved = await Promise.all(batch.map(async (id) => {
      const stored = await storage.getObject(cloudProjectKey(id));
      // A prefix containing only abandoned immutable asset uploads is not a
      // project and must remain invisible.
      if (stored === null) return null;
      const project = parseStoredNamedCloudProjectJson(stored.bytes, id);
      return project === null
        ? ({ id, readable: false } satisfies UnreadableCloudProjectSummary)
        : namedCloudProjectSummary(project);
    }));
    for (const entry of resolved) if (entry !== null) entries.push(entry);
  }
  return entries.sort((a, b) => {
    if (a.readable !== b.readable) return a.readable ? -1 : 1;
    if (a.readable && b.readable) {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      if (byUpdated !== 0) return byUpdated;
    }
    return a.id.localeCompare(b.id);
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return json({ error: session.error }, session.status);
  const storage = getCloudStorage();
  if (storage === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);

  try {
    const ids = await listProjectIds(storage);
    const projects = await readListEntries(storage, ids);
    return json({ projects });
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
}

type CurrentProject =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "ok"; project: CloudProjectRecord };

async function readCurrent(storage: CloudStorage, id: string): Promise<CurrentProject> {
  const stored = await storage.getObject(cloudProjectKey(id));
  if (stored === null) return { kind: "absent" };
  const project = parseStoredNamedCloudProjectJson(stored.bytes, id);
  return project === null ? { kind: "unreadable" } : { kind: "ok", project };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = requireSession(request);
  if (!session.ok) return json({ error: session.error }, session.status);
  const storage = getCloudStorage();
  if (storage === null) return json({ error: CLOUD_UNCONFIGURED_MESSAGE }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed JSON body." }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ error: "Malformed request." }, 400);
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !isValidNewCloudProjectId(record.id) ||
    typeof record.idempotencyToken !== "string" ||
    !CREATION_TOKEN_PATTERN.test(record.idempotencyToken)
  ) {
    return json({ error: "Malformed request." }, 400);
  }
  const project = parseNamedCloudProjectContent(record.project);
  if (project === null) return json({ error: "Invalid project payload." }, 400);

  const id = record.id;
  try {
    const verification = await verifyProjectAssetObjects(storage, id, project.assets);
    if (!verification.ok) {
      return json({ error: "asset-verification-failed", assets: verification.assets }, 409);
    }
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
  const creationTokenHash = sha256(record.idempotencyToken);
  const creationFingerprint = sha256(canonicalJson({ id, project }));
  const timestamp = new Date().toISOString();
  const created: StoredNamedCloudProject = {
    formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
    id,
    name: project.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(project.starterId === undefined ? {} : { starterId: project.starterId }),
    revision: 1,
    creationTokenHash,
    creationFingerprint,
    code: project.code,
    sheets: project.sheets,
    assets: project.assets,
  };

  try {
    await storage.putObject(
      cloudProjectKey(id),
      serializeStoredNamedCloudProject(created),
      "application/json",
      "",
    );
    return json({ project: publicNamedCloudProject({ ...created, legacy: false }) }, 201);
  } catch (error) {
    if (!(error instanceof CloudConditionalWriteError)) {
      return json({ error: describeCloudStorageFailure(error) }, 502);
    }
  }

  // Ambiguous/lost-response retry: only the exact operation may adopt the
  // object. Same ID with a different token or original payload is collision.
  try {
    const current = await readCurrent(storage, id);
    if (
      current.kind === "ok" &&
      current.project.creationTokenHash === creationTokenHash &&
      current.project.creationFingerprint === creationFingerprint
    ) {
      return json({ project: publicNamedCloudProject(current.project) });
    }
    return json({ error: "project-id-conflict" }, 409);
  } catch (error) {
    return json({ error: describeCloudStorageFailure(error) }, 502);
  }
}
