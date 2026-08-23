import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as assetPresignPost } from "@/app/api/cloud/projects/[projectId]/assets/presign/route";
import { GET as assetGet } from "@/app/api/cloud/projects/[projectId]/assets/[hash]/route";
import {
  GET as projectsGet,
  POST as projectsPost,
} from "@/app/api/cloud/projects/route";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_NAME_LENGTH,
  SUPPORTED_ASSET_MIMES,
} from "@/app/editor/_store/assetStore";
import { SESSION_COOKIE_NAME } from "@/lib/cloud/auth";
import {
  cloudAssetKey,
  cloudProjectKey,
} from "@/lib/cloud/projectIdentity";
import { serializeStoredCloudProject } from "@/lib/cloud/projectPayload";
import {
  serializeStoredNamedCloudProject,
  type StoredNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";
import {
  CloudStorageError,
  createInMemoryCloudStorage,
  resetCloudStorageForTests,
  setCloudStorageForTests,
  type CloudStorage,
} from "@/lib/cloud/r2";
import { createSessionCookieValue } from "@/lib/cloud/session";

const BASE = "http://localhost:3000";
const SESSION_SECRET = "named-asset-route-test-secret-32bytes";
const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "223e4567-e89b-42d3-a456-426614174000";
const originalSessionSecret = process.env.SESSION_SECRET;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;
let storage: CloudStorage;

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function cookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue(SESSION_SECRET)}`;
}

function request(
  path: string,
  options: { method?: string; body?: unknown; rawBody?: string; signedIn?: boolean } = {},
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

const presignContext = (projectId: string) => ({ params: Promise.resolve({ projectId }) });
const getContext = (projectId: string, hash: string) => ({
  params: Promise.resolve({ projectId, hash }),
});

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function storedProject(
  id: string,
  assets: StoredNamedCloudProject["assets"] = [],
): StoredNamedCloudProject {
  return {
    formatVersion: 2,
    id,
    name: `Project ${id === ID_A ? "A" : "B"}`,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    revision: 1,
    creationTokenHash: "11".repeat(32),
    creationFingerprint: "22".repeat(32),
    code: "",
    sheets: {},
    assets,
  };
}

async function putManifest(
  id: string,
  assets: StoredNamedCloudProject["assets"] = [],
): Promise<void> {
  await storage.putObject(
    cloudProjectKey(id),
    serializeStoredNamedCloudProject(storedProject(id, assets)),
    "application/json",
  );
}

function declaration(
  bytes = new Uint8Array([1, 2, 3]),
  patch: Partial<{ name: string; mime: string; size: number; hash: string }> = {},
) {
  return {
    name: "art",
    mime: "image/png",
    size: bytes.byteLength,
    hash: sha256(bytes),
    ...patch,
  };
}

async function presign(
  projectId: string,
  body: unknown,
  rawBody?: string,
): Promise<Response> {
  return assetPresignPost(
    request(`/api/cloud/projects/${projectId}/assets/presign`, {
      method: "POST",
      signedIn: true,
      ...(rawBody === undefined ? { body } : { rawBody }),
    }),
    presignContext(projectId),
  );
}

async function getAsset(projectId: string, hash: string, signedIn = true): Promise<Response> {
  return assetGet(
    request(`/api/cloud/projects/${projectId}/assets/${hash}`, { signedIn }),
    getContext(projectId, hash),
  );
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

describe("named-project asset route authorization and identity", () => {
  it("requires authentication on both routes and marks responses no-store", async () => {
    const asset = declaration();
    const post = await assetPresignPost(
      request(`/api/cloud/projects/${ID_A}/assets/presign`, {
        method: "POST",
        body: asset,
      }),
      presignContext(ID_A),
    );
    const get = await getAsset(ID_A, asset.hash, false);
    for (const response of [post, get]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("accepts only cloud project IDs and lowercase SHA-256 paths", async () => {
    for (const id of ["../escape", ID_A.toUpperCase(), `browser-${ID_A}`]) {
      expect((await presign(id, declaration())).status).toBe(400);
      expect((await getAsset(id, declaration().hash)).status).toBe(400);
    }
    // `default` is valid only for migration of the existing legacy slot. It
    // cannot be materialized by staging bytes when no manifest exists.
    expect((await presign("default", declaration())).status).toBe(404);
    expect((await getAsset("default", declaration().hash)).status).toBe(404);
    for (const hash of ["ab", "gg".repeat(32), "AB".repeat(32), `${"ab".repeat(32)}/x`]) {
      expect((await getAsset(ID_A, hash)).status).toBe(400);
    }
  });

  it("returns safe 503s when cloud storage is unavailable", async () => {
    setCloudStorageForTests(null);
    const post = await presign(ID_A, declaration());
    const get = await getAsset(ID_A, declaration().hash);
    expect(post.status).toBe(503);
    expect(get.status).toBe(503);
    expect(JSON.stringify(await responseJson(post))).not.toMatch(/R2_ACCESS|secret/i);
  });
});

describe("POST immutable upload presign", () => {
  it("copies the existing legacy default project into immutable hash storage without deleting its source", async () => {
    const bytes = new Uint8Array([3, 1, 4]);
    const asset = declaration(bytes);
    await storage.putObject(
      cloudProjectKey("default"),
      serializeStoredCloudProject({
        revision: 4,
        code: "",
        sheets: {},
        assets: [asset],
      }),
      "application/json",
    );
    await storage.putObject("projects/default/assets/art", bytes, asset.mime);

    expect((await presign("default", asset)).status).toBe(200);
    await storage.putObject(cloudAssetKey("default", asset.hash), bytes, asset.mime, "");
    expect((await getAsset("default", asset.hash)).status).toBe(200);

    // Publishing/read access to the hash-keyed copy does not consume the
    // name-keyed legacy source; cleanup is deliberately out of band.
    expect(await storage.getObject("projects/default/assets/art")).not.toBeNull();
  });

  it("presigns the project/hash key with exact size/MIME and conditional-create semantics", async () => {
    await putManifest(ID_A);
    const real = storage;
    const presignPut = vi.fn(real.presignPut.bind(real));
    storage = { ...real, presignPut };
    setCloudStorageForTests(storage);
    const asset = declaration();

    const response = await presign(ID_A, asset);
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      url: expect.stringContaining(encodeURIComponent(cloudAssetKey(ID_A, asset.hash))),
      alreadyPresent: false,
      verifyUrl: null,
    });
    expect(presignPut).toHaveBeenCalledWith(
      cloudAssetKey(ID_A, asset.hash),
      asset.mime,
      asset.size,
      300,
      { onlyIfAbsent: true },
    );
  });

  it("enforces every prospective MIME and both size/name boundaries", async () => {
    await putManifest(ID_A);
    for (const mime of SUPPORTED_ASSET_MIMES) {
      expect((await presign(ID_A, declaration(undefined, { mime }))).status).toBe(200);
    }
    expect(
      (await presign(ID_A, declaration(new Uint8Array(ASSET_MAX_BYTES), {
        name: "a".repeat(ASSET_MAX_NAME_LENGTH),
      }))).status,
    ).toBe(200);

    const invalid = [
      declaration(undefined, { name: "" }),
      declaration(undefined, { name: "1bad" }),
      declaration(undefined, { name: "a".repeat(ASSET_MAX_NAME_LENGTH + 1) }),
      declaration(undefined, { mime: "image/bmp" }),
      declaration(undefined, { mime: "image/PNG" }),
      declaration(undefined, { mime: "image/png; charset=x" }),
      declaration(undefined, { size: 0 }),
      declaration(undefined, { size: 1.5 }),
      declaration(undefined, { size: ASSET_MAX_BYTES + 1 }),
      declaration(undefined, { hash: "AB".repeat(32) }),
      declaration(undefined, { hash: "ab" }),
      { ...declaration(), extra: true },
      {},
      null,
    ];
    for (const body of invalid) expect((await presign(ID_A, body)).status).toBe(400);
    expect((await presign(ID_A, null, "{bad-json")).status).toBe(400);
  });

  it("allows pre-create staging without a manifest but rejects an existing unreadable manifest", async () => {
    expect((await presign(ID_A, declaration())).status).toBe(200);
    await storage.putObject(cloudProjectKey(ID_A), new TextEncoder().encode("broken"), "application/json");
    const unreadable = await presign(ID_A, declaration());
    expect(unreadable.status).toBe(500);
    expect(await responseJson(unreadable)).toEqual({ error: "Stored project is unreadable." });
  });

  it("stages before creation, stays unreachable/unlisted while orphaned, then becomes readable only after verified publish", async () => {
    const bytes = new Uint8Array([6, 7, 8, 9]);
    const asset = declaration(bytes);
    const prepared = await presign(ID_A, asset);
    expect(prepared.status).toBe(200);
    expect(await responseJson(prepared)).toMatchObject({ alreadyPresent: false });

    // The browser's conditional direct PUT is represented by the storage
    // fake. Without a manifest, neither list nor GET exposes these bytes.
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), bytes, asset.mime, "");
    expect((await getAsset(ID_A, asset.hash)).status).toBe(404);
    const before = await projectsGet(request("/api/cloud/projects", { signedIn: true }));
    expect(await responseJson(before)).toEqual({ projects: [] });

    const created = await projectsPost(
      request("/api/cloud/projects", {
        method: "POST",
        signedIn: true,
        body: {
          id: ID_A,
          idempotencyToken: "asset-staging-token-1234567890",
          project: {
            name: "Staged asset project",
            code: "",
            sheets: {},
            assets: [asset],
          },
        },
      }),
    );
    expect(created.status).toBe(201);
    expect((await getAsset(ID_A, asset.hash)).status).toBe(200);
    const after = await projectsGet(request("/api/cloud/projects", { signedIn: true }));
    expect((await responseJson(after)).projects).toEqual([
      expect.objectContaining({ id: ID_A, name: "Staged asset project", readable: true }),
    ]);
  });

  it("deduplicates only an exact existing object and never issues another PUT URL", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const asset = declaration(bytes);
    await putManifest(ID_A);
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), bytes, asset.mime);
    const real = storage;
    const presignPut = vi.fn(real.presignPut.bind(real));
    storage = { ...real, presignPut };
    setCloudStorageForTests(storage);

    const response = await presign(ID_A, asset);
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      url: null,
      alreadyPresent: true,
      verifyUrl: expect.stringContaining(encodeURIComponent(cloudAssetKey(ID_A, asset.hash))),
    });
    expect(presignPut).not.toHaveBeenCalled();
  });

  it("fails safely when existing bytes, MIME, or size disagree with the declared hash metadata", async () => {
    await putManifest(ID_A);
    const correct = new Uint8Array([7, 8, 9]);
    const asset = declaration(correct);
    const cases: Array<{ bytes: Uint8Array; mime: string; request: ReturnType<typeof declaration> }> = [
      { bytes: new Uint8Array([7, 8, 8]), mime: asset.mime, request: asset },
      { bytes: correct, mime: "image/jpeg", request: asset },
      { bytes: correct, mime: asset.mime, request: { ...asset, size: correct.byteLength + 1 } },
    ];
    for (let index = 0; index < cases.length; index++) {
      storage = createInMemoryCloudStorage();
      setCloudStorageForTests(storage);
      await putManifest(ID_A);
      const item = cases[index];
      await storage.putObject(cloudAssetKey(ID_A, asset.hash), item.bytes, item.mime);
      const response = await presign(ID_A, item.request);
      expect(response.status, `case ${index}`).toBe(409);
      expect(await responseJson(response)).toEqual({ error: "immutable-asset-conflict" });
    }
  });
});

describe("GET immutable asset presign", () => {
  it("presigns only a manifest-referenced object after server-side integrity verification", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const asset = declaration(bytes);
    await putManifest(ID_A, [asset]);
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), bytes, asset.mime);
    const real = storage;
    const presignGet = vi.fn(real.presignGet.bind(real));
    storage = { ...real, presignGet };
    setCloudStorageForTests(storage);

    const response = await getAsset(ID_A, asset.hash);
    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      url: expect.stringContaining(encodeURIComponent(cloudAssetKey(ID_A, asset.hash))),
    });
    expect(presignGet).toHaveBeenCalledWith(cloudAssetKey(ID_A, asset.hash), 300);
  });

  it("does not expose abandoned or missing objects", async () => {
    const asset = declaration();
    await putManifest(ID_A);
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), new Uint8Array([1, 2, 3]), asset.mime);
    expect((await getAsset(ID_A, asset.hash)).status).toBe(404); // object exists, manifest does not reference it

    storage = createInMemoryCloudStorage();
    setCloudStorageForTests(storage);
    await putManifest(ID_A, [asset]);
    expect((await getAsset(ID_A, asset.hash)).status).toBe(404); // manifest references, object absent
  });

  it("fails safely for corrupt bytes/MIME/size and contradictory same-hash metadata", async () => {
    const bytes = new Uint8Array([1, 3, 5]);
    const asset = declaration(bytes);
    const corruptions = [
      { storedBytes: new Uint8Array([1, 3, 4]), storedMime: asset.mime, manifest: [asset] },
      { storedBytes: bytes, storedMime: "image/jpeg", manifest: [asset] },
      { storedBytes: bytes, storedMime: asset.mime, manifest: [{ ...asset, size: 4 }] },
      {
        storedBytes: bytes,
        storedMime: asset.mime,
        manifest: [asset, { ...asset, name: "same_hash_other_mime", mime: "image/jpeg" }],
      },
    ];
    for (const corruption of corruptions) {
      storage = createInMemoryCloudStorage();
      setCloudStorageForTests(storage);
      await putManifest(ID_A, corruption.manifest);
      await storage.putObject(
        cloudAssetKey(ID_A, asset.hash),
        corruption.storedBytes,
        corruption.storedMime,
      );
      expect((await getAsset(ID_A, asset.hash)).status).toBe(409);
    }
  });

  it("requires an existing readable owning manifest", async () => {
    const hash = declaration().hash;
    expect((await getAsset(ID_A, hash)).status).toBe(404);
    await storage.putObject(cloudProjectKey(ID_A), new TextEncoder().encode("broken"), "application/json");
    expect((await getAsset(ID_A, hash)).status).toBe(500);
  });
});

describe("project isolation and storage failure posture", () => {
  it("never deduplicates or reads an identical hash across project boundaries", async () => {
    const bytes = new Uint8Array([2, 4, 6, 8]);
    const asset = declaration(bytes);
    await putManifest(ID_A, [asset]);
    await putManifest(ID_B, [asset]);
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), bytes, asset.mime);

    expect(await responseJson(await presign(ID_A, asset))).toMatchObject({ alreadyPresent: true });
    expect(await responseJson(await presign(ID_B, asset))).toMatchObject({ alreadyPresent: false });
    expect((await getAsset(ID_A, asset.hash)).status).toBe(200);
    expect((await getAsset(ID_B, asset.hash)).status).toBe(404);
  });

  it("maps manifest/object/presign provider failures to safe 502 responses", async () => {
    const asset = declaration();
    const failure = new CloudStorageError("private provider detail", {
      operation: "GET",
      status: 503,
      code: "SlowDown",
    });
    const failingRead: CloudStorage = {
      ...storage,
      getObject: vi.fn(async () => { throw failure; }),
    };
    setCloudStorageForTests(failingRead);
    const readFailure = await presign(ID_A, asset);
    expect(readFailure.status).toBe(502);
    expect(JSON.stringify(await responseJson(readFailure))).not.toContain("private provider detail");
    const getReadFailure = await getAsset(ID_A, asset.hash);
    expect(getReadFailure.status).toBe(502);

    storage = createInMemoryCloudStorage();
    await putManifest(ID_A);
    const real = storage;
    const failingPresign: CloudStorage = {
      ...real,
      presignPut: vi.fn(async () => {
        throw new CloudStorageError("private", { operation: "PUT", status: 500, code: "Internal" });
      }),
    };
    setCloudStorageForTests(failingPresign);
    expect((await presign(ID_A, asset)).status).toBe(502);

    storage = createInMemoryCloudStorage();
    await putManifest(ID_A, [asset]);
    await storage.putObject(cloudAssetKey(ID_A, asset.hash), new Uint8Array([1, 2, 3]), asset.mime);
    const failingGetPresign: CloudStorage = {
      ...storage,
      presignGet: vi.fn(async () => {
        throw new CloudStorageError("private", { operation: "GET", status: 500, code: "Internal" });
      }),
    };
    setCloudStorageForTests(failingGetPresign);
    expect((await getAsset(ID_A, asset.hash)).status).toBe(502);
  });
});
