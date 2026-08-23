/**
 * Browser transport for the named-project API (DESIGN ◆53).
 *
 * Every response is shape-checked before it can become editor state. The
 * transport throws only this module's fixed, user-safe errors; proxy bodies
 * and provider diagnostics are never reflected into the chooser.
 */

import type { StoredAsset } from "@/app/editor/_store/assetStore";
import type { CloudProjectSummary } from "@/app/editor/_store/projectLifecycle";
import {
  parseNamedCloudProjectContent,
  type NamedCloudProjectContent,
  type PublicNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";
import {
  isValidCloudProjectId,
  SHA256_HEX_PATTERN,
} from "@/lib/cloud/projectIdentity";
import { parseCloudProject } from "@/lib/cloud/projectPayload";
import { normalizeProjectName } from "@/lib/projects/projectMetadata";

export type ProjectCloudErrorKind =
  | "unavailable"
  | "unauthorized"
  | "not-found"
  | "conflict"
  | "invalid-response";

export class ProjectCloudClientError extends Error {
  readonly kind: ProjectCloudErrorKind;
  readonly status: number | null;

  constructor(kind: ProjectCloudErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ProjectCloudClientError";
    this.kind = kind;
    this.status = status;
  }
}

type FetchLike = typeof fetch;
export const CLOUD_REQUEST_TIMEOUT_MS = 15_000;

interface TimedResponse<T> {
  response: Response;
  body: T;
}

async function requestWithTimeout<T>(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
): Promise<TimedResponse<T>> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("cloud request timed out"));
    }, CLOUD_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(input, { ...init, signal: controller.signal });
        return { response, body: await consume(response) };
      })(),
      timeout,
    ]);
  } finally {
    if (!timedOut && timeoutId !== null) clearTimeout(timeoutId);
  }
}

interface JsonBody {
  valid: boolean;
  value: unknown;
}

type JsonResponse = TimedResponse<JsonBody>;

function readJson(result: JsonResponse): unknown {
  if (!result.body.valid) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The cloud service returned an invalid response. Please retry.",
      result.response.status,
    );
  }
  return result.body.value;
}

function responseFailure(result: JsonResponse): ProjectCloudClientError {
  const { response } = result;
  if (response.status === 401) {
    return new ProjectCloudClientError(
      "unauthorized",
      "Your admin session has ended. Sign in again from Admin.",
      401,
    );
  }
  if (response.status === 404) {
    return new ProjectCloudClientError("not-found", "That cloud project no longer exists.", 404);
  }
  if (response.status === 409) {
    const raw = result.body.valid ? result.body.value : undefined;
    const code = typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).error
      : undefined;
    if (code === "asset-verification-failed") {
      return new ProjectCloudClientError(
        "conflict",
        "Cloud asset verification did not finish. Retry the operation.",
        409,
      );
    }
    return new ProjectCloudClientError(
      "conflict",
      "The cloud project changed on another device. Reopen it before saving.",
      409,
    );
  }
  return new ProjectCloudClientError(
    "unavailable",
    "The cloud service is unavailable. Please retry.",
    response.status,
  );
}

async function sameOriginJson(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit = {},
): Promise<JsonResponse> {
  try {
    return await requestWithTimeout(fetchImpl, input, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    }, async (response) => {
      try {
        return { valid: true, value: await response.json() };
      } catch {
        return { valid: false, value: undefined };
      }
    });
  } catch {
    throw new ProjectCloudClientError(
      "unavailable",
      "The cloud service could not be reached. Check your connection and retry.",
    );
  }
}

export async function probeProjectSession(
  fetchImpl: FetchLike = fetch,
): Promise<"admin" | "anonymous"> {
  const result = await sameOriginJson(fetchImpl, "/api/cloud/session");
  const { response } = result;
  if (response.status === 401) return "anonymous";
  if (!response.ok) throw responseFailure(result);
  const raw = readJson(result);
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>).authenticated !== true
  ) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The admin session could not be verified. Please retry.",
      response.status,
    );
  }
  return "admin";
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function parseCloudSummary(raw: unknown): CloudProjectSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !isValidCloudProjectId(item.id)) return null;
  if (item.readable === false) {
    return {
      id: item.id,
      name: `Damaged project (${item.id.slice(0, 8)})`,
      createdAt: "",
      updatedAt: "",
      readable: false,
    };
  }
  const name = typeof item.name === "string" ? normalizeProjectName(item.name) : null;
  if (
    item.readable !== true ||
    name === null ||
    !name.ok ||
    name.name !== item.name ||
    !isIsoTimestamp(item.createdAt) ||
    !isIsoTimestamp(item.updatedAt)
  ) {
    return null;
  }
  return {
    id: item.id,
    name: name.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    readable: true,
  };
}

export async function listNamedCloudProjects(
  fetchImpl: FetchLike = fetch,
): Promise<CloudProjectSummary[]> {
  const result = await sameOriginJson(fetchImpl, "/api/cloud/projects");
  const { response } = result;
  if (!response.ok) throw responseFailure(result);
  const raw = readJson(result);
  const projects =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).projects
      : undefined;
  if (!Array.isArray(projects)) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The cloud project list was invalid. Please retry.",
      response.status,
    );
  }
  const parsed = projects.map(parseCloudSummary);
  if (parsed.some((project) => project === null)) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The cloud project list was invalid. Please retry.",
      response.status,
    );
  }
  return parsed as CloudProjectSummary[];
}

function parsePublicProject(raw: unknown, expectedId: string): PublicNamedCloudProject | null {
  if (typeof raw !== "object" || raw === null) return null;
  const project = raw as Record<string, unknown>;
  if (
    project.formatVersion !== 2 ||
    project.id !== expectedId ||
    typeof project.revision !== "number" ||
    !Number.isInteger(project.revision) ||
    project.revision < 1 ||
    !isIsoTimestamp(project.createdAt) ||
    !isIsoTimestamp(project.updatedAt) ||
    typeof project.legacy !== "boolean"
  ) {
    return null;
  }
  let content: NamedCloudProjectContent | null;
  if (project.legacy) {
    const normalizedName = typeof project.name === "string"
      ? normalizeProjectName(project.name)
      : null;
    const legacy = parseCloudProject(project);
    if (
      legacy === null ||
      normalizedName?.ok !== true ||
      normalizedName.name !== project.name
    ) return null;
    content = { name: normalizedName.name, ...legacy };
  } else {
    content = parseNamedCloudProjectContent(project);
  }
  if (content === null) return null;
  return {
    formatVersion: 2,
    id: expectedId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    revision: project.revision,
    legacy: project.legacy,
    ...content,
  };
}

function parseProjectEnvelope(raw: unknown, expectedId: string): PublicNamedCloudProject {
  const value =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).project
      : undefined;
  const project = parsePublicProject(value, expectedId);
  if (project === null) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The cloud project was invalid and was not opened.",
    );
  }
  return project;
}

export async function getNamedCloudProject(
  id: string,
  fetchImpl: FetchLike = fetch,
): Promise<PublicNamedCloudProject> {
  if (!isValidCloudProjectId(id)) {
    throw new ProjectCloudClientError("invalid-response", "The cloud project ID is invalid.");
  }
  const result = await sameOriginJson(
    fetchImpl,
    `/api/cloud/projects/${encodeURIComponent(id)}`,
  );
  if (!result.response.ok) throw responseFailure(result);
  return parseProjectEnvelope(readJson(result), id);
}

export interface CreateNamedCloudProjectRequest {
  id: string;
  idempotencyToken: string;
  project: NamedCloudProjectContent;
}

export async function createNamedCloudProject(
  request: CreateNamedCloudProjectRequest,
  fetchImpl: FetchLike = fetch,
): Promise<PublicNamedCloudProject> {
  const result = await sameOriginJson(fetchImpl, "/api/cloud/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!result.response.ok) throw responseFailure(result);
  return parseProjectEnvelope(readJson(result), request.id);
}

export async function updateNamedCloudProject(
  id: string,
  baseRevision: number,
  project: NamedCloudProjectContent,
  fetchImpl: FetchLike = fetch,
): Promise<{ revision: number; updatedAt: string }> {
  const responseResult = await sameOriginJson(
    fetchImpl,
    `/api/cloud/projects/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision, project }),
      keepalive: true,
    },
  );
  const { response } = responseResult;
  if (!response.ok) throw responseFailure(responseResult);
  const raw = readJson(responseResult);
  const result = raw as Record<string, unknown>;
  if (
    typeof result?.revision !== "number" ||
    !Number.isInteger(result.revision) ||
    result.revision <= baseRevision ||
    !isIsoTimestamp(result.updatedAt)
  ) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The cloud save could not be verified. Please retry.",
      response.status,
    );
  }
  return { revision: result.revision, updatedAt: result.updatedAt };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function storedAssetBytes(asset: StoredAsset): Promise<Uint8Array> {
  return asset.bytes instanceof Blob
    ? new Uint8Array(await asset.bytes.arrayBuffer())
    : asset.bytes;
}

interface PresignResponse {
  url: string | null;
  alreadyPresent: boolean;
  verifyUrl: string | null;
}

function parsePresignResponse(raw: unknown): PresignResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.alreadyPresent === true &&
    (value.url === null || value.url === undefined) &&
    typeof value.verifyUrl === "string" &&
    value.verifyUrl.length > 0
  ) {
    return { url: null, alreadyPresent: true, verifyUrl: value.verifyUrl };
  }
  return value.alreadyPresent === false &&
    typeof value.url === "string" &&
    value.url.length > 0 &&
    value.verifyUrl === null
    ? { url: value.url, alreadyPresent: false, verifyUrl: null }
    : null;
}

async function prepareNamedAsset(
  projectId: string,
  asset: { name: string; mime: string; size: number; hash: string },
  fetchImpl: FetchLike,
): Promise<PresignResponse> {
  const result = await sameOriginJson(
    fetchImpl,
    `/api/cloud/projects/${encodeURIComponent(projectId)}/assets/presign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asset),
    },
  );
  if (!result.response.ok) throw responseFailure(result);
  const presign = parsePresignResponse(readJson(result));
  if (presign === null) {
    throw new ProjectCloudClientError(
      "invalid-response",
      "The asset upload could not be prepared. Please retry.",
    );
  }
  return presign;
}

export async function uploadNamedProjectAsset(
  projectId: string,
  asset: StoredAsset,
  fetchImpl: FetchLike = fetch,
): Promise<{ name: string; mime: string; size: number; hash: string }> {
  const bytes = await storedAssetBytes(asset);
  const hash = await sha256Hex(bytes);
  const declaration = { name: asset.name, mime: asset.mime, size: bytes.byteLength, hash };
  let presign = await prepareNamedAsset(projectId, declaration, fetchImpl);
  if (!presign.alreadyPresent) {
    let uploaded: Response;
    try {
      uploaded = (await requestWithTimeout(fetchImpl, presign.url!, {
        method: "PUT",
        credentials: "omit",
        // The project-scoped presign includes this conditional-create header
        // in its signature. Content-addressed keys must never be overwritten,
        // even by a second holder of the same still-live URL.
        headers: { "Content-Type": asset.mime, "If-None-Match": "*" },
        body: bytes as BodyInit,
      }, async () => undefined)).response;
    } catch {
      throw new ProjectCloudClientError(
        "unavailable",
        `The asset “${asset.name}” could not be uploaded. Please retry.`,
      );
    }
    if (!uploaded.ok) {
      throw new ProjectCloudClientError(
        "unavailable",
        `The asset “${asset.name}” could not be uploaded. Please retry.`,
        uploaded.status,
      );
    }
    // Re-run the authenticated declaration after PUT. The server reads and
    // verifies the stored MIME, size, and SHA-256 before issuing this GET URL.
    presign = await prepareNamedAsset(projectId, declaration, fetchImpl);
    if (!presign.alreadyPresent) {
      throw new ProjectCloudClientError(
        "unavailable",
        `The asset “${asset.name}” could not be verified. Please retry.`,
      );
    }
  }
  let verifiedBytes: Uint8Array;
  try {
    const verification = await requestWithTimeout(
      fetchImpl,
      presign.verifyUrl!,
      { credentials: "omit" },
      async (response) => new Uint8Array(await response.arrayBuffer()),
    );
    if (!verification.response.ok) throw new Error("verification download failed");
    verifiedBytes = verification.body;
  } catch {
    throw new ProjectCloudClientError(
      "unavailable",
      `The asset “${asset.name}” could not be verified. Please retry.`,
    );
  }
  if (verifiedBytes.byteLength !== bytes.byteLength || (await sha256Hex(verifiedBytes)) !== hash) {
    throw new ProjectCloudClientError(
      "invalid-response",
      `The asset “${asset.name}” failed cloud integrity verification.`,
    );
  }
  return { name: asset.name, mime: asset.mime, size: bytes.byteLength, hash };
}

export async function downloadNamedProjectAsset(
  projectId: string,
  entry: { name: string; mime: string; size: number; hash: string },
  legacy: boolean,
  fetchImpl: FetchLike = fetch,
): Promise<StoredAsset> {
  if (!SHA256_HEX_PATTERN.test(entry.hash)) {
    throw new ProjectCloudClientError("invalid-response", "A cloud asset hash was invalid.");
  }
  const route = legacy
    ? `/api/cloud/assets/${encodeURIComponent(entry.name)}`
    : `/api/cloud/projects/${encodeURIComponent(projectId)}/assets/${entry.hash}`;
  const result = await sameOriginJson(fetchImpl, route);
  if (!result.response.ok) throw responseFailure(result);
  const raw = readJson(result);
  const url =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).url
      : undefined;
  if (typeof url !== "string" || url.length === 0) {
    throw new ProjectCloudClientError(
      "invalid-response",
      `The asset “${entry.name}” could not be downloaded.`,
    );
  }
  let bytes: Uint8Array;
  try {
    const download = await requestWithTimeout(
      fetchImpl,
      url,
      { credentials: "omit" },
      async (response) => new Uint8Array(await response.arrayBuffer()),
    );
    if (!download.response.ok) throw new Error("download failed");
    bytes = download.body;
  } catch {
    throw new ProjectCloudClientError(
      "unavailable",
      `The asset “${entry.name}” could not be downloaded. Please retry.`,
    );
  }
  if (bytes.byteLength !== entry.size || (await sha256Hex(bytes)) !== entry.hash) {
    throw new ProjectCloudClientError(
      "invalid-response",
      `The asset “${entry.name}” failed integrity verification.`,
    );
  }
  return { name: entry.name, mime: entry.mime, bytes };
}
