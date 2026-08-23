import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET as projectsGet,
  POST as projectsPost,
} from "@/app/api/cloud/projects/route";
import {
  GET as projectGet,
  PUT as projectPut,
} from "@/app/api/cloud/projects/[projectId]/route";
import { SESSION_COOKIE_NAME } from "@/lib/cloud/auth";
import { createSessionCookieValue } from "@/lib/cloud/session";
import {
  createInMemoryCloudStorage,
  resetCloudStorageForTests,
  setCloudStorageForTests,
  type CloudStorage,
} from "@/lib/cloud/r2";
import { cloudAssetKey, cloudProjectKey } from "@/lib/cloud/projectIdentity";
import {
  parseStoredNamedCloudProjectJson,
  serializeStoredNamedCloudProject,
  type NamedCloudProjectContent,
  type StoredNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";
import { serializeStoredCloudProject } from "@/lib/cloud/projectPayload";

const BASE = "http://localhost:3000";
const SESSION_SECRET = "named-project-route-test-secret-32bytes";
const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "223e4567-e89b-42d3-a456-426614174000";
const ID_C = "323e4567-e89b-42d3-a456-426614174000";
const TOKEN_A = "create-token-A-1234567890";
const TOKEN_B = "create-token-B-1234567890";
const ASSET_BYTES = new Uint8Array([1, 2, 3]);
const SHA = createHash("sha256").update(ASSET_BYTES).digest("hex");
const originalSessionSecret = process.env.SESSION_SECRET;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;
let storage: CloudStorage;

function cookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue(SESSION_SECRET)}`;
}

function request(
  path: string,
  options: { method?: string; body?: unknown; signedIn?: boolean; rawBody?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.signedIn) headers.cookie = cookieHeader();
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.rawBody !== undefined
      ? { body: options.rawBody }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ projectId: id }) });

function content(name: string, code = "", patch: Partial<NamedCloudProjectContent> = {}): NamedCloudProjectContent {
  return { name, code, sheets: {}, assets: [], ...patch };
}

function creationBody(
  id = ID_A,
  token = TOKEN_A,
  project: NamedCloudProjectContent = content("Project A", "a"),
): unknown {
  return { id, idempotencyToken: token, project };
}

async function create(
  id = ID_A,
  token = TOKEN_A,
  project: NamedCloudProjectContent = content("Project A", "a"),
): Promise<Response> {
  return projectsPost(request("/api/cloud/projects", {
    method: "POST",
    signedIn: true,
    body: creationBody(id, token, project),
  }));
}

type TestJson = Record<string, unknown> & {
  project?: Record<string, unknown>;
  projects?: unknown;
};

async function responseJson(response: Response): Promise<TestJson> {
  return response.json() as Promise<TestJson>;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.ADMIN_PASSWORD_HASH = "configured-for-route-tests";
  storage = createInMemoryCloudStorage();
  setCloudStorageForTests(storage);
});

afterEach(() => {
  resetCloudStorageForTests();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  else process.env.ADMIN_PASSWORD_HASH = originalPasswordHash;
});

describe("named project route authentication and response caching", () => {
  it("protects collection and item methods with the shared session guard", async () => {
    const responses = [
      await projectsGet(request("/api/cloud/projects")),
      await projectsPost(request("/api/cloud/projects", { method: "POST", body: creationBody() })),
      await projectGet(request(`/api/cloud/projects/${ID_A}`), context(ID_A)),
      await projectPut(
        request(`/api/cloud/projects/${ID_A}`, {
          method: "PUT",
          body: { baseRevision: 1, project: content("A") },
        }),
        context(ID_A),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("returns a safe no-store 503 when storage is unavailable", async () => {
    setCloudStorageForTests(null);
    const response = await projectsGet(request("/api/cloud/projects", { signedIn: true }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await responseJson(response))).not.toContain("R2_ACCESS_KEY_ID");
  });
});

describe("POST /api/cloud/projects", () => {
  it("conditionally creates revision 1 with server-owned metadata and hashed idempotency fields", async () => {
    // The immutable upload route binds the reviewed logical Content-Type
    // before creation is retried. Seed that already-uploaded object.
    await storage.putObject(
      cloudAssetKey(ID_A, SHA),
      ASSET_BYTES,
      "image/png",
      "",
    );
    const response = await create(
      ID_A,
      TOKEN_A,
      content("First project", "code", {
        starterId: "blank",
        assets: [{ name: "dragon", mime: "image/png", size: 3, hash: SHA }],
      }),
    );
    expect(response.status).toBe(201);
    const body = await responseJson(response);
    const publicProject = body.project!;
    expect(publicProject).toMatchObject({
      id: ID_A,
      name: "First project",
      revision: 1,
      starterId: "blank",
      legacy: false,
    });
    expect(publicProject.creationTokenHash).toBeUndefined();
    expect(publicProject.creationFingerprint).toBeUndefined();

    const stored = await storage.getObject(cloudProjectKey(ID_A));
    const text = new TextDecoder().decode(stored!.bytes);
    const parsed = parseStoredNamedCloudProjectJson(stored!.bytes, ID_A)!;
    expect(parsed.creationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.creationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.createdAt).toBe(parsed.updatedAt);
    expect(text).not.toContain(TOKEN_A);
    expect(body).not.toHaveProperty("assetsVerified"); // no redundant client-trusted claim
  });

  it("does not publish a manifest until every immutable object readback matches MIME, size, and SHA-256", async () => {
    const project = content("With art", "", {
      assets: [{ name: "dragon", mime: "image/png", size: ASSET_BYTES.byteLength, hash: SHA }],
    });

    const missing = await create(ID_A, TOKEN_A, project);
    expect(missing.status).toBe(409);
    expect(await responseJson(missing)).toEqual({
      error: "asset-verification-failed",
      assets: [{ name: "dragon", hash: SHA, reasons: ["missing"] }],
    });
    expect(await storage.getObject(cloudProjectKey(ID_A))).toBeNull();

    await storage.putObject(
      cloudAssetKey(ID_A, SHA),
      new Uint8Array([9, 9]),
      "image/jpeg",
      "",
    );
    const mismatched = await create(ID_A, TOKEN_A, project);
    expect(mismatched.status).toBe(409);
    expect((await responseJson(mismatched)).assets).toEqual([
      {
        name: "dragon",
        hash: SHA,
        reasons: ["stored-mime-mismatch", "size-mismatch", "hash-mismatch"],
      },
    ]);
    expect(await storage.getObject(cloudProjectKey(ID_A))).toBeNull();

    const existing = await storage.getObject(cloudAssetKey(ID_A, SHA));
    await storage.putObject(
      cloudAssetKey(ID_A, SHA),
      ASSET_BYTES,
      "image/png",
      existing!.etag,
    );
    expect((await create(ID_A, TOKEN_A, project)).status).toBe(201);
  });

  it("adopts an exact lost-response retry but rejects any changed token or original payload", async () => {
    expect((await create()).status).toBe(201);

    const retry = await create();
    expect(retry.status).toBe(200);
    expect((await responseJson(retry)).project).toMatchObject({ id: ID_A, revision: 1 });

    const changedPayload = await create(ID_A, TOKEN_A, content("Project A", "different"));
    expect(changedPayload.status).toBe(409);
    expect(await responseJson(changedPayload)).toEqual({ error: "project-id-conflict" });

    const changedToken = await create(ID_A, "another-token-1234567890", content("Project A", "a"));
    expect(changedToken.status).toBe(409);
  });

  it("fingerprints canonical content rather than caller object-key insertion order", async () => {
    const sheetsA = {
      Alpha: { rows: [{ b: "2", a: "1" }], editedRows: [true] },
      Beta: { rows: [], editedRows: [] },
    };
    const sheetsB = {
      Beta: { editedRows: [], rows: [] },
      Alpha: { editedRows: [true], rows: [{ a: "1", b: "2" }] },
    };
    expect((await create(ID_A, TOKEN_A, { ...content("Canonical"), sheets: sheetsA })).status).toBe(201);
    expect((await create(ID_A, TOKEN_A, { ...content("Canonical"), sheets: sheetsB })).status).toBe(200);
  });

  it("rejects reserved/path IDs, weak tokens, malformed JSON, names, and strict asset violations", async () => {
    const cases: unknown[] = [
      creationBody("default"),
      creationBody("../escape"),
      creationBody(ID_A, "short"),
      creationBody(ID_A, TOKEN_A, content(" padded ")),
      creationBody(ID_A, TOKEN_A, content("Bad asset", "", {
        assets: [{ name: "dragon", mime: "image/bmp", size: 3, hash: SHA }],
      })),
      creationBody(ID_A, TOKEN_A, content("Bad hash", "", {
        assets: [{ name: "dragon", mime: "image/png", size: 0, hash: SHA }],
      })),
    ];
    for (const body of cases) {
      const response = await projectsPost(request("/api/cloud/projects", {
        method: "POST",
        signedIn: true,
        body,
      }));
      expect(response.status).toBe(400);
    }
    const malformed = await projectsPost(request("/api/cloud/projects", {
      method: "POST",
      signedIn: true,
      rawBody: "{not-json",
    }));
    expect(malformed.status).toBe(400);
  });
});

describe("GET /api/cloud/projects", () => {
  it("follows every delimiter page, lists legacy/damaged manifests, and ignores asset-only prefixes", async () => {
    const namedA: StoredNamedCloudProject = {
      formatVersion: 2,
      id: ID_A,
      name: "Older",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      revision: 1,
      creationTokenHash: "11".repeat(32),
      creationFingerprint: "22".repeat(32),
      code: "",
      sheets: {},
      assets: [],
    };
    const namedB: StoredNamedCloudProject = {
      ...namedA,
      id: ID_B,
      name: "Newest",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    await storage.putObject(cloudProjectKey(ID_A), serializeStoredNamedCloudProject(namedA), "application/json");
    await storage.putObject(cloudProjectKey(ID_B), serializeStoredNamedCloudProject(namedB), "application/json");
    await storage.putObject(cloudProjectKey(ID_C), new TextEncoder().encode("damaged"), "application/json");
    await storage.putObject("projects/423e4567-e89b-42d3-a456-426614174000/assets/" + SHA, new Uint8Array([1]), "application/octet-stream");
    await storage.putObject(
      cloudProjectKey("default"),
      serializeStoredCloudProject({ revision: 7, code: "legacy", sheets: {}, assets: [] }),
      "application/json",
    );

    const real = storage;
    const listPage = vi.fn((options: Parameters<CloudStorage["listPage"]>[0]) =>
      real.listPage({ ...options, maxKeys: 1 }));
    storage = { ...real, listPage };
    setCloudStorageForTests(storage);

    const response = await projectsGet(request("/api/cloud/projects", { signedIn: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const projects = (await responseJson(response)).projects;
    expect(projects).toEqual([
      expect.objectContaining({ id: ID_B, name: "Newest", readable: true }),
      expect.objectContaining({ id: ID_A, name: "Older", readable: true }),
      expect.objectContaining({ id: "default", name: "Legacy Cloud Project", readable: true, legacy: true }),
      { id: ID_C, readable: false },
    ]);
    expect(listPage.mock.calls.length).toBeGreaterThan(1);
    expect(listPage.mock.calls.every(([options]) => options.delimiter === "/")).toBe(true);
  });
});

describe("GET/PUT /api/cloud/projects/:projectId", () => {
  it("keeps content, revisions, and writes isolated by immutable project ID", async () => {
    await create(ID_A, TOKEN_A, content("A", "a1"));
    await create(ID_B, TOKEN_B, content("B", "b1"));

    const update = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project: content("A renamed", "a2") },
      }),
      context(ID_A),
    );
    expect(update.status).toBe(200);
    expect(await responseJson(update)).toMatchObject({ revision: 2 });

    const a = await projectGet(request(`/api/cloud/projects/${ID_A}`, { signedIn: true }), context(ID_A));
    const b = await projectGet(request(`/api/cloud/projects/${ID_B}`, { signedIn: true }), context(ID_B));
    expect((await responseJson(a)).project).toMatchObject({ id: ID_A, name: "A renamed", code: "a2", revision: 2 });
    expect((await responseJson(b)).project).toMatchObject({ id: ID_B, name: "B", code: "b1", revision: 1 });
  });

  it("retains server creation metadata and original starter ID across update/rename", async () => {
    await create(ID_A, TOKEN_A, content("A", "a1", { starterId: "blank" }));
    const before = parseStoredNamedCloudProjectJson((await storage.getObject(cloudProjectKey(ID_A)))!.bytes, ID_A)!;

    const response = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: {
          baseRevision: 1,
          project: content("Renamed", "a2", { starterId: "party-game" }),
        },
      }),
      context(ID_A),
    );
    expect(response.status).toBe(200);
    const after = parseStoredNamedCloudProjectJson((await storage.getObject(cloudProjectKey(ID_A)))!.bytes, ID_A)!;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.creationTokenHash).toBe(before.creationTokenHash);
    expect(after.creationFingerprint).toBe(before.creationFingerprint);
    expect(after.starterId).toBe("blank");
    expect(after.name).toBe("Renamed");
  });

  it("verifies immutable asset readback before a PUT can publish its next revision", async () => {
    await create();
    const project = content("A with art", "a2", {
      assets: [{ name: "dragon", mime: "image/png", size: ASSET_BYTES.byteLength, hash: SHA }],
    });
    const missing = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project },
      }),
      context(ID_A),
    );
    expect(missing.status).toBe(409);
    expect((await responseJson(missing)).error).toBe("asset-verification-failed");
    expect(parseStoredNamedCloudProjectJson((await storage.getObject(cloudProjectKey(ID_A)))!.bytes, ID_A)!.revision).toBe(1);

    await storage.putObject(
      cloudAssetKey(ID_A, SHA),
      ASSET_BYTES,
      "image/png",
      "",
    );
    const updated = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project },
      }),
      context(ID_A),
    );
    expect(updated.status).toBe(200);
    expect(parseStoredNamedCloudProjectJson((await storage.getObject(cloudProjectKey(ID_A)))!.bytes, ID_A)!.revision).toBe(2);
  });

  it("reads and revision-upgrades the legacy default object in place", async () => {
    await storage.putObject(
      cloudProjectKey("default"),
      serializeStoredCloudProject({ revision: 7, code: "legacy", sheets: {}, assets: [] }),
      "application/json",
    );
    const before = await projectGet(request("/api/cloud/projects/default", { signedIn: true }), context("default"));
    expect((await responseJson(before)).project).toMatchObject({
      id: "default",
      name: "Legacy Cloud Project",
      revision: 7,
      legacy: true,
    });

    const updated = await projectPut(
      request("/api/cloud/projects/default", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 7, project: content("Renamed legacy", "upgraded") },
      }),
      context("default"),
    );
    expect(updated.status).toBe(200);
    const stored = parseStoredNamedCloudProjectJson((await storage.getObject(cloudProjectKey("default")))!.bytes, "default")!;
    expect(stored).toMatchObject({ id: "default", name: "Renamed legacy", revision: 8, legacy: false });
    expect(stored.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(stored.creationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.creationFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid IDs, stale revisions, missing objects, and malformed payloads", async () => {
    const invalid = await projectGet(
      request("/api/cloud/projects/..", { signedIn: true }),
      context("../escape"),
    );
    expect(invalid.status).toBe(400);

    const missing = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project: content("Missing") },
      }),
      context(ID_A),
    );
    expect(missing.status).toBe(404);

    await create();
    const stale = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 2, project: content("Stale") },
      }),
      context(ID_A),
    );
    expect(stale.status).toBe(409);
    expect(await responseJson(stale)).toEqual({ error: "revision-conflict", revision: 1 });

    const malformed = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        rawBody: "{bad",
      }),
      context(ID_A),
    );
    expect(malformed.status).toBe(400);
  });

  it("closes the read/write race with the manifest's strong ETag", async () => {
    await create();
    const real = storage;
    const before = await real.getObject(cloudProjectKey(ID_A));
    const winnerBase = parseStoredNamedCloudProjectJson(before!.bytes, ID_A)!;
    const winner: StoredNamedCloudProject = {
      formatVersion: winnerBase.formatVersion,
      id: winnerBase.id,
      name: "Race winner",
      createdAt: winnerBase.createdAt,
      updatedAt: new Date().toISOString(),
      ...(winnerBase.starterId === undefined ? {} : { starterId: winnerBase.starterId }),
      creationTokenHash: winnerBase.creationTokenHash,
      creationFingerprint: winnerBase.creationFingerprint,
      code: "winner",
      sheets: winnerBase.sheets,
      assets: winnerBase.assets,
      revision: 2,
    };
    let injected = false;
    const racy: CloudStorage = {
      ...real,
      async putObject(key, bytes, mime, ifMatch) {
        if (!injected && key === cloudProjectKey(ID_A)) {
          injected = true;
          await real.putObject(
            key,
            serializeStoredNamedCloudProject(winner),
            "application/json",
            before!.etag,
          );
        }
        return real.putObject(key, bytes, mime, ifMatch);
      },
    };
    setCloudStorageForTests(racy);

    const response = await projectPut(
      request(`/api/cloud/projects/${ID_A}`, {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project: content("Race loser", "loser") },
      }),
      context(ID_A),
    );
    expect(response.status).toBe(409);
    expect(await responseJson(response)).toEqual({ error: "revision-conflict", revision: 2 });
    const final = parseStoredNamedCloudProjectJson((await real.getObject(cloudProjectKey(ID_A)))!.bytes, ID_A)!;
    expect(final.code).toBe("winner");
  });
});
