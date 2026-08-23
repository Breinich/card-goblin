import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorStore, type EditorSeed } from "@/app/editor/_store/editorStore";
import {
  createAssetStore,
  createInMemoryAssetAdapter,
  type AssetStore,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";
import {
  commitStagedProjectRecord,
  createProjectRecordSession,
  readProjectRecord,
  stageProjectRecord,
  type ProjectRecordSession,
  type ProjectRecordStorage,
} from "@/app/editor/_store/projectRepository";
import {
  createNamedProjectSyncController,
  type NamedProjectSyncController,
  type NamedProjectSyncTransport,
} from "@/app/editor/_store/namedProjectSync";
import {
  ProjectCloudClientError,
  sha256Hex,
  type VerifiedCloudAssetUpload,
} from "@/app/editor/_lib/namedCloudClient";
import type { NamedCloudProjectContent } from "@/lib/cloud/namedProjectPayload";
import type { CloudAssetManifestEntry } from "@/lib/cloud/projectPayload";
import type { AssetVerificationSubmission } from "@/lib/cloud/namedProjectAsset";

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";
const HASH = "ab".repeat(32);
const RECEIPT = `1800000000000.${"r".repeat(43)}`;
const EMPTY_SEED: EditorSeed = { code: "", sheets: {} };

class MemoryStorage implements ProjectRecordStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface UpdateCall {
  projectId: string;
  baseRevision: number;
  project: NamedCloudProjectContent;
  assetVerification: readonly AssetVerificationSubmission[];
}

class FakeTransport implements NamedProjectSyncTransport {
  readonly events: string[] = [];
  readonly uploads: Array<{ projectId: string; asset: StoredAsset }> = [];
  readonly updates: UpdateCall[] = [];
  updateImpl: (
    call: UpdateCall,
  ) => Promise<{ revision: number; updatedAt: string }> = async (call) => ({
    revision: call.baseRevision + 1,
    updatedAt: "2026-08-22T12:00:00.000Z",
  });

  async uploadAsset(projectId: string, asset: StoredAsset): Promise<VerifiedCloudAssetUpload> {
    this.events.push(`upload:${projectId}:${asset.name}`);
    this.uploads.push({ projectId, asset });
    const size = asset.bytes instanceof Blob ? asset.bytes.size : asset.bytes.byteLength;
    return { name: asset.name, mime: asset.mime, size, hash: HASH, verificationReceipt: RECEIPT };
  }

  async updateProject(
    projectId: string,
    baseRevision: number,
    project: NamedCloudProjectContent,
    assetVerification: readonly AssetVerificationSubmission[] = [],
  ): Promise<{ revision: number; updatedAt: string }> {
    this.events.push(`update:${projectId}:${baseRevision}`);
    const call = { projectId, baseRevision, project, assetVerification };
    this.updates.push(call);
    return this.updateImpl(call);
  }
}

interface Harness {
  storage: MemoryStorage;
  editor: ReturnType<typeof createEditorStore>;
  assets: AssetStore;
  session: ProjectRecordSession;
  transport: FakeTransport;
  controller: NamedProjectSyncController;
}

function harness(options: {
  seed?: EditorSeed;
  initialAssetManifest?: CloudAssetManifestEntry[];
  initialAssetVerification?: AssetVerificationSubmission[];
  transport?: FakeTransport;
  assets?: AssetStore;
} = {}): Harness {
  const seed = options.seed ?? EMPTY_SEED;
  const storage = new MemoryStorage();
  const active = commitStagedProjectRecord(
    storage,
    stageProjectRecord(storage, {
      location: "cloud",
      id: PROJECT_ID,
      name: "Deck",
      revision: 1,
      seed,
    }),
  );
  const assets = options.assets ?? createAssetStore(createInMemoryAssetAdapter(), false, "prospective");
  const editor = createEditorStore(seed, assets);
  const session = createProjectRecordSession(storage, active);
  const transport = options.transport ?? new FakeTransport();
  const controller = createNamedProjectSyncController({
    projectId: PROJECT_ID,
    baseRevision: 1,
    editor,
    projectSession: session,
    assets,
    initialAssetManifest: options.initialAssetManifest,
    initialAssetVerification: options.initialAssetVerification,
    transport,
    debounceMs: 50,
    now: () => 123_456,
  });
  return { storage, editor, assets, session, transport, controller };
}

async function waitForCalls(transport: FakeTransport, count: number): Promise<void> {
  await vi.waitFor(() => expect(transport.updates).toHaveLength(count));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("named project-scoped autosync", () => {
  it("flushes the browser draft synchronously, then debounces a revision-checked push", async () => {
    vi.useFakeTimers();
    const { controller, editor, storage, transport } = harness();
    const identity = { location: "cloud" as const, id: PROJECT_ID };
    const stable = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(stable);

    editor.getState().setCode("Card: One\n  size: poker\n");
    // Local durability happens inside the editor subscription, before the
    // caller regains control; remote I/O remains debounced.
    expect(readProjectRecord(storage, identity)?.seed.code).toContain("Card: One");
    expect(transport.updates).toHaveLength(0);
    expect(controller.getSnapshot()).not.toBe(stable);
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", dirty: true, revision: 1 });

    await vi.advanceTimersByTimeAsync(25);
    editor.getState().setCode("Card: Two\n  size: poker\n");
    await vi.advanceTimersByTimeAsync(25);
    expect(transport.updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(25);
    await waitForCalls(transport, 1);
    expect(transport.updates[0]).toMatchObject({ projectId: PROJECT_ID, baseRevision: 1 });
    expect(transport.updates[0].project.code).toContain("Card: Two");
    expect(controller.getSnapshot()).toMatchObject({
      status: "idle",
      dirty: false,
      revision: 2,
      lastSyncedAt: 123_456,
    });
    expect(readProjectRecord(storage, identity)?.revision).toBe(2);
    controller.destroy();
  });

  it("persists and syncs a rename even when editor content is unchanged", async () => {
    const { controller, session, storage, transport } = harness();
    expect(session.rename("  Renamed Deck  ")).toMatchObject({ ok: true, name: "Renamed Deck" });
    expect(readProjectRecord(storage, { location: "cloud", id: PROJECT_ID })?.name).toBe("Renamed Deck");

    await expect(controller.flush()).resolves.toBe(true);
    expect(transport.updates).toHaveLength(1);
    expect(transport.updates[0].project.name).toBe("Renamed Deck");
    controller.destroy();
  });

  it("carries legacy migration receipts through the first rename commit", async () => {
    const assets = createAssetStore(createInMemoryAssetAdapter(), false, "prospective");
    await assets.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));
    const initialManifest = [{ name: "dragon", mime: "image/png", size: 3, hash: HASH }];
    const initialAssetVerification = [{ name: "dragon", receipt: RECEIPT }];
    const { controller, session, transport } = harness({
      assets,
      initialAssetManifest: initialManifest,
      initialAssetVerification,
    });

    session.rename("Migrated Deck");
    await expect(controller.flush()).resolves.toBe(true);

    expect(transport.uploads).toHaveLength(0);
    expect(transport.updates[0]?.assetVerification).toEqual(initialAssetVerification);
    controller.destroy();
  });

  it("uploads immutable assets before PUT and reuses a trusted manifest for content-only saves", async () => {
    const assets = createAssetStore(createInMemoryAssetAdapter(), false, "prospective");
    await assets.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));
    const initialManifest = [{ name: "dragon", mime: "image/png", size: 3, hash: HASH }];
    const first = harness({ assets, initialAssetManifest: initialManifest });

    first.editor.getState().setCode("changed");
    await expect(first.controller.flush()).resolves.toBe(true);
    expect(first.transport.uploads).toHaveLength(0);
    expect(first.transport.updates[0].project.assets).toEqual(initialManifest);
    first.controller.destroy();

    const second = harness();
    await second.assets.upload("dragon", "image/png", new Uint8Array([4, 5, 6]));
    await expect(second.controller.flush()).resolves.toBe(true);
    expect(second.transport.events).toEqual([
      `upload:${PROJECT_ID}:dragon`,
      `update:${PROJECT_ID}:1`,
    ]);
    expect(second.transport.updates[0].project.assets).toEqual(initialManifest);
    expect(second.transport.updates[0].assetVerification).toEqual([
      { name: "dragon", receipt: RECEIPT },
    ]);
    second.controller.destroy();
  });

  it("hashes a large changed library locally and uploads only the changed asset", async () => {
    const assets = createAssetStore(createInMemoryAssetAdapter(), false, "prospective");
    const initialManifest: CloudAssetManifestEntry[] = [];
    for (let index = 0; index < 101; index += 1) {
      const bytes = new Uint8Array([index]);
      const name = `asset_${index}`;
      await assets.upload(name, "image/png", bytes);
      initialManifest.push({
        name,
        mime: "image/png",
        size: 1,
        hash: await sha256Hex(bytes),
      });
    }
    const getBytes = vi.fn(assets.getBytes);
    const observedAssets: AssetStore = { ...assets, getBytes };
    const instance = harness({ assets: observedAssets, initialAssetManifest: initialManifest });
    await assets.upload("asset_50", "image/png", new Uint8Array([250]));

    await expect(instance.controller.flush()).resolves.toBe(true);

    expect(instance.transport.uploads.map(({ asset }) => asset.name)).toEqual(["asset_50"]);
    expect(getBytes).toHaveBeenCalledTimes(1);
    expect(getBytes).toHaveBeenCalledWith("asset_50");
    expect(instance.transport.updates[0]?.project.assets).toHaveLength(101);
    instance.controller.destroy();
  });

  it("queues edits made during a push and drains them against the returned revision without retargeting", async () => {
    const transport = new FakeTransport();
    let resolveFirst!: (value: { revision: number; updatedAt: string }) => void;
    transport.updateImpl = (call) => {
      if (transport.updates.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        revision: call.baseRevision + 1,
        updatedAt: "2026-08-22T12:01:00.000Z",
      });
    };
    const { controller, editor, session } = harness({ transport });
    editor.getState().setCode("first");
    const flushing = controller.flush();
    await waitForCalls(transport, 1);

    editor.getState().setCode("second");
    session.rename("Second name");
    resolveFirst({ revision: 2, updatedAt: "2026-08-22T12:00:00.000Z" });

    await expect(flushing).resolves.toBe(true);
    expect(transport.updates).toHaveLength(2);
    expect(transport.updates.map((call) => call.projectId)).toEqual([PROJECT_ID, PROJECT_ID]);
    expect(transport.updates.map((call) => call.baseRevision)).toEqual([1, 2]);
    expect(transport.updates[0].project.code).toBe("first");
    expect(transport.updates[1].project).toMatchObject({ code: "second", name: "Second name" });
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", revision: 3, dirty: false });
    controller.destroy();
  });

  it("keeps the revision unchanged on offline failure and Retry drains the preserved draft", async () => {
    const transport = new FakeTransport();
    let attempts = 0;
    transport.updateImpl = async (call) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProjectCloudClientError("unavailable", "secret provider detail", 502);
      }
      return { revision: call.baseRevision + 1, updatedAt: "2026-08-22T12:00:00.000Z" };
    };
    const { controller, editor, storage } = harness({ transport });
    editor.getState().setCode("safe locally");

    await expect(controller.flush()).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "offline", revision: 1, dirty: true });
    expect(controller.getSnapshot().error).not.toContain("secret provider detail");
    expect(readProjectRecord(storage, { location: "cloud", id: PROJECT_ID })?.seed.code).toBe("safe locally");

    await expect(controller.retry()).resolves.toBe(true);
    expect(transport.updates.map((call) => call.baseRevision)).toEqual([1, 1]);
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", revision: 2, dirty: false });
    controller.destroy();
  });

  it("surfaces a revision conflict without advancing or losing the local draft", async () => {
    const transport = new FakeTransport();
    transport.updateImpl = async () => {
      throw new ProjectCloudClientError("conflict", "raw conflict detail", 409);
    };
    const { controller, editor, storage } = harness({ transport });
    editor.getState().setCode("conflicting local work");

    await expect(controller.flush()).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "conflict", revision: 1, dirty: true });
    expect(controller.getSnapshot().error).not.toContain("raw conflict detail");
    expect(readProjectRecord(storage, { location: "cloud", id: PROJECT_ID })?.seed.code).toBe(
      "conflicting local work",
    );
    controller.destroy();
  });

  it("stops remote writes on an authoritative 401 while preserving later edits locally", async () => {
    const transport = new FakeTransport();
    transport.updateImpl = async () => {
      throw new ProjectCloudClientError("unauthorized", "expired", 401);
    };
    const { controller, editor, storage } = harness({ transport });
    editor.getState().setCode("before expiry");
    await expect(controller.flush()).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "signed-out", dirty: true });

    editor.getState().setCode("after expiry, still safe");
    await expect(controller.flush()).resolves.toBe(true);
    expect(transport.updates).toHaveLength(1);
    expect(readProjectRecord(storage, { location: "cloud", id: PROJECT_ID })?.seed.code).toBe(
      "after expiry, still safe",
    );
    controller.destroy();
  });

  it("accepts a cross-tab session-ended signal without attempting a remote write", async () => {
    const { controller, editor, storage, transport } = harness();
    controller.sessionEnded();
    editor.getState().setCode("local after cross-tab sign-out");

    await expect(controller.flush()).resolves.toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ status: "signed-out", dirty: true });
    expect(transport.updates).toHaveLength(0);
    expect(readProjectRecord(storage, { location: "cloud", id: PROJECT_ID })?.seed.code).toBe(
      "local after cross-tab sign-out",
    );
    controller.destroy();
  });

  it("does not PUT or advance revision when immutable upload fails", async () => {
    const transport = new FakeTransport();
    transport.uploadAsset = async () => {
      throw new ProjectCloudClientError("unavailable", "upload failed", 502);
    };
    const { controller, assets } = harness({ transport });
    await assets.upload("dragon", "image/png", new Uint8Array([1, 2, 3]));

    await expect(controller.flush()).resolves.toBe(false);
    expect(transport.updates).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({ status: "offline", revision: 1, dirty: true });
    controller.destroy();
  });
});
