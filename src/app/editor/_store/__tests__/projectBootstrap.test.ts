import { describe, expect, it, vi } from "vitest";
import {
  createAssetStore,
  createInMemoryAssetAdapter,
  createInMemoryAssetMigrationStateStore,
  createInMemoryProjectAssetAdapterFactory,
  type AssetAdapter,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";
import { createEditorStore, type EditorSeed } from "@/app/editor/_store/editorStore";
import {
  cloudAssetCompatibilityErrors,
  createProjectBootstrapController,
  stageExactProjectAssets,
  type ProjectBootstrapDependencies,
} from "@/app/editor/_store/projectBootstrap";
import {
  ACTIVE_PROJECT_POINTER_KEY,
  BROWSER_PROJECT_POINTER_KEY,
  commitStagedProjectRecord,
  readActiveProjectRecord,
  readProjectRecord,
  stageProjectRecord,
  updateProjectRecord,
  type ProjectRecordStorage,
} from "@/app/editor/_store/projectRepository";
import { createProjectLifecycleController } from "@/app/editor/_store/projectLifecycle";
import { ProjectCloudClientError } from "@/app/editor/_lib/namedCloudClient";
import {
  buildProjectExport,
  parseImportedProjectFile,
} from "@/app/editor/_lib/projectFileFormat";
import { frozenCurrentProjectFileReader } from "@/app/editor/_lib/__tests__/fixtures/frozenCurrentProjectFileReader";
import type { PublicNamedCloudProject } from "@/lib/cloud/namedProjectPayload";

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "223e4567-e89b-42d3-a456-426614174001";
const UUID_C = "323e4567-e89b-42d3-a456-426614174002";

class MemoryStorage implements ProjectRecordStorage {
  readonly map = new Map<string, string>();
  failSetKey: string | null = null;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (key === this.failSetKey) throw new Error("storage unavailable");
    this.map.set(key, value);
  }
}

const blank: EditorSeed = { code: "", sheets: {} };
const imported: EditorSeed = {
  code: "Card Imported\n  Text: title\n",
  sheets: { Imported: { rows: [{ title: "Hello" }], editedRows: [true] } },
};
const art: StoredAsset = {
  name: "art",
  mime: "image/png",
  bytes: new Uint8Array([1, 2, 3]),
};

function publicProject(overrides: Partial<PublicNamedCloudProject> = {}): PublicNamedCloudProject {
  return {
    formatVersion: 2,
    id: UUID_A,
    name: "Cloud Deck",
    createdAt: "2026-08-22T01:02:03.000Z",
    updatedAt: "2026-08-22T01:02:03.000Z",
    revision: 1,
    code: imported.code,
    sheets: imported.sheets,
    assets: [],
    legacy: false,
    ...overrides,
  };
}

function harness(overrides: Partial<ProjectBootstrapDependencies> = {}) {
  const lifecycle = createProjectLifecycleController();
  const storage = new MemoryStorage();
  const assetFactory = createInMemoryProjectAssetAdapterFactory();
  const editorAssets = createAssetStore(createInMemoryAssetAdapter());
  const editor = createEditorStore(blank, editorAssets);
  const uuids = [UUID_A, UUID_B, UUID_C];
  const activation = vi.fn();
  const dependencies: ProjectBootstrapDependencies = {
    lifecycle,
    editor,
    assets: editorAssets,
    storage,
    projectAssetFactory: assetFactory,
    legacyAssetAdapter: createInMemoryAssetAdapter(),
    migrationState: createInMemoryAssetMigrationStateStore(),
    bindAssets: vi.fn(),
    markAutosaveDisabled: vi.fn(),
    randomUuid: () => uuids.shift() ?? UUID_C,
    probeSession: async () => "anonymous",
    listCloud: async () => [],
    getCloud: async (id) => publicProject({ id }),
    createCloud: async ({ id }) => publicProject({ id }),
    updateCloud: async (_id, revision) => ({
      revision: revision + 1,
      updatedAt: "2026-08-22T02:03:04.000Z",
    }),
    uploadCloudAsset: async (_id, record) => ({
      name: record.name,
      mime: record.mime,
      size: record.bytes instanceof Blob ? record.bytes.size : record.bytes.byteLength,
      hash: "00".repeat(32),
    }),
    downloadCloudAsset: async () => art,
    onActivated: activation,
    ...overrides,
  };
  return {
    lifecycle,
    storage,
    assetFactory,
    editor,
    activation,
    dependencies,
    controller: createProjectBootstrapController(dependencies),
  };
}

async function expectActiveProjectRemainsPortable(
  storage: ProjectRecordStorage,
  assetFactory: ReturnType<typeof createInMemoryProjectAssetAdapterFactory>,
): Promise<void> {
  const active = readActiveProjectRecord(storage);
  if (active === null) throw new Error("Expected an active project record.");
  const assets = await assetFactory(active.id).list();
  const { json } = await buildProjectExport(
    active.seed.code,
    active.seed.sheets,
    null,
    assets,
    active.name,
  );
  const current = parseImportedProjectFile(json);
  expect(current).toMatchObject({ seed: active.seed, name: active.name });
  const frozen = frozenCurrentProjectFileReader(json);
  expect(frozen).toMatchObject({ code: active.seed.code, sheets: active.seed.sheets });
  expect(frozen?.assets.map((asset) => ({
    name: asset.name,
    mime: asset.mime,
    bytes: [...asset.bytes],
  }))).toEqual(await Promise.all(assets.map(async (asset) => ({
    name: asset.name,
    mime: asset.mime,
    bytes: [...(asset.bytes instanceof Blob
      ? new Uint8Array(await asset.bytes.arrayBuffer())
      : asset.bytes)],
  }))));
}

describe("atomic project asset staging", () => {
  it("writes, removes stale records, and verifies exact bytes", async () => {
    const adapter = createInMemoryAssetAdapter([
      { name: "old", mime: "image/png", bytes: new Uint8Array([9]) },
    ]);
    await expect(stageExactProjectAssets(adapter, [art])).resolves.toEqual([art]);
    await expect(adapter.list()).resolves.toEqual([art]);
  });

  it("rejects duplicates without changing storage", async () => {
    const adapter = createInMemoryAssetAdapter([art]);
    await expect(stageExactProjectAssets(adapter, [art, art])).rejects.toThrow(/duplicate/);
    await expect(adapter.list()).resolves.toEqual([art]);
  });

  it("names every legacy asset reason that blocks cloud creation", () => {
    expect(cloudAssetCompatibilityErrors([
      { name: "x".repeat(101), mime: "image/tiff", bytes: new Uint8Array() },
    ])).toEqual([
      `${"x".repeat(101)}: name exceeds 100 characters, unsupported MIME image/tiff, zero bytes`,
    ]);
  });
});

describe("project bootstrap", () => {
  it("starts anonymous only after the session probe and creates a named browser project", async () => {
    const h = harness();
    await h.controller.start();
    expect(h.lifecycle.getSnapshot()).toMatchObject({ role: "anonymous", phase: "choosing" });

    await h.controller.openImportedProject(
      { seed: imported, assets: [art] },
      "Imported Deck",
      "file-a",
    );

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: {
        location: "browser",
        id: `browser-${UUID_A}`,
        name: "Imported Deck",
        revision: null,
      },
    });
    expect(readActiveProjectRecord(h.storage)?.seed).toEqual(imported);
    await expect(h.assetFactory(`browser-${UUID_A}`).list()).resolves.toEqual([art]);
    expect(h.editor.getState().code).toBe(imported.code);
    expect(h.activation).toHaveBeenCalledTimes(1);
    await expectActiveProjectRemainsPortable(h.storage, h.assetFactory);
  });

  it("flushes and detaches the outgoing autosave before replacing the editor seed", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.openImportedProject({ seed: blank, assets: [] }, "Old Deck", "old");
    const old = readActiveProjectRecord(h.storage)!;

    h.editor.getState().setCode("old unsaved work");
    h.controller.openChooser();
    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "New Deck", "new");

    expect(readProjectRecord(h.storage, old)?.seed.code).toBe("old unsaved work");
    expect(readActiveProjectRecord(h.storage)).toMatchObject({ name: "New Deck", seed: imported });
    expect(h.editor.getState().code).toBe(imported.code);
    h.controller.dispose();
  });

  it("does not activate a load cancelled while the outgoing project drains", async () => {
    let drainCount = 0;
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const h = harness({
      beforeActivate: () => {
        drainCount += 1;
        return drainCount === 2 ? drainGate : true;
      },
    });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: blank, assets: [] }, "Old Deck", "old");
    const old = readActiveProjectRecord(h.storage)!;

    h.controller.openChooser();
    const opening = h.controller.openImportedProject(
      { seed: imported, assets: [art] },
      "Cancelled Deck",
      "cancelled",
    );
    await vi.waitFor(() => expect(drainCount).toBe(2));
    h.controller.cancelChooser();
    releaseDrain();
    await opening;

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: {
        location: old.location,
        id: old.id,
        name: old.name,
        revision: old.revision,
      },
    });
    expect(readActiveProjectRecord(h.storage)).toEqual(old);
    expect(h.editor.getState().code).toBe(old.seed.code);
  });

  it("blocks a switch when the outgoing cloud drain reports failure", async () => {
    let drainCount = 0;
    const h = harness({
      beforeActivate: () => {
        drainCount += 1;
        return drainCount === 1 ? true : false;
      },
    });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: blank, assets: [] }, "Old Deck", "old");
    const old = readActiveProjectRecord(h.storage)!;

    h.controller.openChooser();
    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "New Deck", "new");

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "open-error",
      activeProject: {
        location: old.location,
        id: old.id,
        name: old.name,
        revision: old.revision,
      },
      error: expect.stringMatching(/could not be saved/i),
    });
    expect(readActiveProjectRecord(h.storage)).toEqual(old);
    expect(h.editor.getState().code).toBe(old.seed.code);
  });

  it("never changes the old pointer or editor when inactive asset staging fails", async () => {
    const storage = new MemoryStorage();
    const old = {
      location: "browser" as const,
      id: `browser-${UUID_B}`,
      name: "Safe old project",
      revision: null,
      seed: blank,
    };
    commitStagedProjectRecord(storage, stageProjectRecord(storage, old));
    const failing: AssetAdapter = {
      ...createInMemoryAssetAdapter(),
      put: async () => { throw new Error("quota"); },
    };
    const h = harness({
      storage,
      projectAssetFactory: () => failing,
    });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "New", "file");

    expect(h.lifecycle.getSnapshot().phase).toBe("open-error");
    expect(readActiveProjectRecord(storage)).toEqual(old);
    expect(h.editor.getState().code).toBe("");
    expect(h.activation).not.toHaveBeenCalled();
  });

  it("keeps the outgoing project attached when the final pointer write fails", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.openImportedProject({ seed: blank, assets: [] }, "Old Deck", "old");
    const old = readActiveProjectRecord(h.storage)!;

    h.controller.openChooser();
    h.storage.failSetKey = ACTIVE_PROJECT_POINTER_KEY;
    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "New Deck", "new");

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "open-error",
      activeProject: { id: old.id, name: old.name },
    });
    expect(readActiveProjectRecord(h.storage)).toEqual(old);
    expect(h.editor.getState().code).toBe(old.seed.code);
    expect(h.activation).toHaveBeenCalledTimes(1);

    h.storage.failSetKey = null;
    h.editor.getState().setCode("work after failed switch");
    h.controller.flushLocal();
    expect(readProjectRecord(h.storage, old)?.seed.code).toBe("work after failed switch");
  });

  it("migrates legacy content/assets only after Continue and preserves the old sources", async () => {
    const storage = new MemoryStorage();
    const legacyRaw = JSON.stringify({
      version: 1,
      code: imported.code,
      sheets: imported.sheets,
    });
    storage.setItem("cardgoblin.project.v1", legacyRaw);
    const legacyAsset: StoredAsset = {
      name: "grandfathered",
      mime: "image/tiff",
      bytes: new Uint8Array(),
    };
    const legacyAssets = createInMemoryAssetAdapter([legacyAsset]);
    const assetFactory = createInMemoryProjectAssetAdapterFactory();
    const h = harness({
      storage,
      legacyAssetAdapter: legacyAssets,
      projectAssetFactory: assetFactory,
    });

    await h.controller.start();
    expect(h.lifecycle.getSnapshot().browserRecovery).toMatchObject({
      name: "Browser Project",
    });
    expect(readActiveProjectRecord(storage)).toBeNull();
    await h.controller.continueBrowserProject();

    expect(readActiveProjectRecord(storage)).toMatchObject({
      id: "browser-legacy-v1",
      seed: imported,
    });
    expect(storage.getItem("cardgoblin.project.v1")).toBe(legacyRaw);
    await expect(legacyAssets.list()).resolves.toEqual([legacyAsset]);
    await expect(assetFactory("browser-legacy-v1").list()).resolves.toEqual([legacyAsset]);
    await expectActiveProjectRemainsPortable(storage, assetFactory);
  });

  it("runs the guarded activation path for legacy Continue and blocks on a failed drain", async () => {
    const storage = new MemoryStorage();
    storage.setItem("cardgoblin.project.v1", JSON.stringify({
      version: 1,
      code: imported.code,
      sheets: imported.sheets,
    }));
    const beforeActivate = vi.fn(async () => false);
    const h = harness({ storage, beforeActivate });

    await h.controller.start();
    await h.controller.continueBrowserProject();

    expect(beforeActivate).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getSnapshot().phase).toBe("open-error");
    expect(readActiveProjectRecord(storage)).toBeNull();
    expect(h.editor.getState().code).toBe("");
  });

  it("discovers and reopens the last browser project while a cloud cache is globally active", async () => {
    const storage = new MemoryStorage();
    const browser = {
      location: "browser" as const,
      id: `browser-${UUID_B}`,
      name: "Local Deck",
      revision: null,
      seed: imported,
    };
    commitStagedProjectRecord(storage, stageProjectRecord(storage, browser));
    const cloud = {
      location: "cloud" as const,
      id: UUID_A,
      name: "Cloud Deck",
      revision: 3,
      seed: blank,
    };
    commitStagedProjectRecord(storage, stageProjectRecord(storage, cloud));
    const assetFactory = createInMemoryProjectAssetAdapterFactory();
    await assetFactory(browser.id).put(art);
    const h = harness({ storage, projectAssetFactory: assetFactory });

    await h.controller.start();
    expect(h.lifecycle.getSnapshot().browserRecovery).toMatchObject({
      id: browser.id,
      name: browser.name,
    });
    updateProjectRecord(storage, {
      ...browser,
      seed: { code: "newer browser work", sheets: browser.seed.sheets },
    });
    await h.controller.continueBrowserProject();

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: { location: "browser", id: browser.id },
    });
    expect(readActiveProjectRecord(storage)).toMatchObject({
      id: browser.id,
      seed: { code: "newer browser work" },
    });
    expect(h.editor.getState().code).toBe("newer browser work");
  });

  it("treats Continue for the already-active browser project as a safe chooser cancel", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.openImportedProject({ seed: blank, assets: [] }, "Local Deck", "local");
    const active = readActiveProjectRecord(h.storage)!;
    h.editor.getState().setCode("latest unsaved editor work");
    h.controller.openChooser();
    expect(readProjectRecord(h.storage, active)?.seed.code).toBe("latest unsaved editor work");

    await h.controller.continueBrowserProject();

    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: { id: active.id, location: "browser" },
      browserRecovery: { id: active.id, name: "Local Deck" },
    });
    expect(h.editor.getState().code).toBe("latest unsaved editor work");
    expect(readProjectRecord(h.storage, active)?.seed.code).toBe("latest unsaved editor work");
    expect(h.activation).toHaveBeenCalledTimes(1);
  });

  it("upgrades an active pre-browser-pointer record when Continue is chosen", async () => {
    const storage = new MemoryStorage();
    const browser = {
      location: "browser" as const,
      id: `browser-${UUID_B}`,
      name: "Older Local Deck",
      revision: null,
      seed: imported,
    };
    commitStagedProjectRecord(storage, stageProjectRecord(storage, browser));
    storage.map.delete(BROWSER_PROJECT_POINTER_KEY); // simulate the prior build
    const h = harness({ storage });

    await h.controller.start();
    await h.controller.continueBrowserProject();

    expect(storage.getItem(BROWSER_PROJECT_POINTER_KEY)).not.toBeNull();
    expect(readActiveProjectRecord(storage)).toEqual(browser);
  });

  it("preserves an older browser pointer when admin opens cloud directly from startup", async () => {
    const storage = new MemoryStorage();
    const browser = {
      location: "browser" as const,
      id: `browser-${UUID_B}`,
      name: "Older Local Deck",
      revision: null,
      seed: imported,
    };
    commitStagedProjectRecord(storage, stageProjectRecord(storage, browser));
    storage.map.delete(BROWSER_PROJECT_POINTER_KEY);
    const h = harness({
      storage,
      probeSession: async () => "admin",
      listCloud: async () => [{
        id: UUID_A,
        name: "Cloud Deck",
        createdAt: "2026-08-22T01:02:03.000Z",
        updatedAt: "2026-08-22T01:02:03.000Z",
        readable: true,
      }],
    });

    await h.controller.start();
    await h.controller.openCloudProject(h.lifecycle.getSnapshot().cloudProjects[0]!);

    expect(readActiveProjectRecord(storage)).toMatchObject({ location: "cloud", id: UUID_A });
    expect(storage.getItem(BROWSER_PROJECT_POINTER_KEY)).not.toBeNull();
    const returning = harness({ storage });
    await returning.controller.start();
    expect(returning.lifecycle.getSnapshot().browserRecovery).toMatchObject({
      id: browser.id,
      name: browser.name,
    });
  });

  it("uses one cloud ID/token across a failed create Retry and publishes only after verification", async () => {
    const events: string[] = [];
    const requests: Parameters<ProjectBootstrapDependencies["createCloud"]>[0][] = [];
    let createAttempt = 0;
    const h = harness({
      probeSession: async () => "admin",
      uploadCloudAsset: async (id, record) => {
        events.push(`upload:${id}:${record.name}`);
        return { name: record.name, mime: record.mime, size: 3, hash: "11".repeat(32) };
      },
      createCloud: async (request) => {
        events.push(`create:${request.id}`);
        requests.push(request);
        createAttempt += 1;
        if (createAttempt === 1) throw new ProjectCloudClientError("unavailable", "retry");
        return publicProject({ id: request.id, assets: request.project.assets });
      },
      getCloud: async (id) => {
        events.push(`verify:${id}`);
        return publicProject({
          id,
          assets: [{ name: "art", mime: "image/png", size: 3, hash: "11".repeat(32) }],
        });
      },
    });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "Cloud Deck", "same");
    expect(h.lifecycle.getSnapshot().phase).toBe("open-error");
    expect(readActiveProjectRecord(h.storage)).toBeNull();

    await h.controller.openImportedProject({ seed: imported, assets: [art] }, "Cloud Deck", "same");
    expect(h.lifecycle.getSnapshot().phase).toBe("ready");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.id).toBe(requests[0]?.id);
    expect(requests[1]?.idempotencyToken).toBe(requests[0]?.idempotencyToken);
    expect(events).toEqual([
      `upload:${UUID_A}:art`,
      `create:${UUID_A}`,
      `upload:${UUID_A}:art`,
      `create:${UUID_A}`,
      `verify:${UUID_A}`,
    ]);
    await expectActiveProjectRemainsPortable(h.storage, h.assetFactory);
  });

  it("refreshes the cloud list whenever an admin reopens New / Open", async () => {
    const listCloud = vi.fn(async () => []);
    const h = harness({ probeSession: async () => "admin", listCloud });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: imported, assets: [] }, "Cloud Deck", "file");
    expect(listCloud).toHaveBeenCalledTimes(1);

    h.controller.openChooser();
    await vi.waitFor(() => expect(listCloud).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.lifecycle.getSnapshot().phase).toBe("choosing"));
  });

  it("reuses the exact creation fingerprint when the name changes after an ambiguous failure", async () => {
    const requests: Parameters<ProjectBootstrapDependencies["createCloud"]>[0][] = [];
    const updateCloud = vi.fn(async (
      ...args: Parameters<ProjectBootstrapDependencies["updateCloud"]>
    ) => ({
      revision: args[1] + 1,
      updatedAt: "2026-08-22T03:04:05.000Z",
    }));
    let createAttempt = 0;
    let renamed = false;
    const h = harness({
      probeSession: async () => "admin",
      createCloud: async (request) => {
        requests.push(request);
        createAttempt += 1;
        if (createAttempt === 1) throw new ProjectCloudClientError("unavailable", "retry");
        return publicProject({ id: request.id, name: request.project.name });
      },
      updateCloud: async (...args) => {
        renamed = true;
        return updateCloud(...args);
      },
      getCloud: async (id) => publicProject({
        id,
        name: renamed ? "Renamed Retry" : "Original Name",
        revision: renamed ? 2 : 1,
      }),
    });
    await h.controller.start();
    await h.controller.openImportedProject({ seed: imported, assets: [] }, "Original Name", "same-file");
    await h.controller.openImportedProject({ seed: imported, assets: [] }, "Renamed Retry", "same-file");

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      id: requests[0]!.id,
      idempotencyToken: requests[0]!.idempotencyToken,
      project: { name: "Original Name" },
    });
    expect(updateCloud).toHaveBeenCalledWith(
      requests[0]!.id,
      1,
      expect.objectContaining({ name: "Renamed Retry" }),
    );
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: { id: requests[0]!.id, name: "Renamed Retry", revision: 2 },
    });
  });

  it("offers an explicit cached/cloud choice and applies cloud only after selection", async () => {
    const storage = new MemoryStorage();
    stageProjectRecord(storage, {
      location: "cloud",
      id: UUID_A,
      name: "Cached",
      revision: 1,
      seed: { code: "cached", sheets: {} },
    });
    const assetFactory = createInMemoryProjectAssetAdapterFactory();
    await assetFactory(UUID_A).put({
      name: "local",
      mime: "image/png",
      bytes: new Uint8Array([4]),
    });
    const h = harness({
      storage,
      projectAssetFactory: assetFactory,
      probeSession: async () => "admin",
      listCloud: async () => [{
        id: UUID_A,
        name: "Remote",
        createdAt: "2026-08-22T01:02:03.000Z",
        updatedAt: "2026-08-22T02:03:04.000Z",
        readable: true,
      }],
      getCloud: async () => publicProject({ name: "Remote", revision: 2, assets: [] }),
    });
    await h.controller.start();
    await h.controller.openCloudProject(h.lifecycle.getSnapshot().cloudProjects[0]!);

    expect(h.lifecycle.getSnapshot().phase).toBe("open-error");
    expect(h.controller.getSnapshot().conflict).toMatchObject({
      projectId: UUID_A,
      browserName: "Cached",
      cloudName: "Remote",
    });
    expect(h.editor.getState().code).toBe("");

    await h.controller.resolveCloudConflict("cloud");
    expect(h.lifecycle.getSnapshot().phase).toBe("ready");
    expect(h.editor.getState().code).toBe(imported.code);
    expect(readActiveProjectRecord(storage)).toMatchObject({ name: "Remote", revision: 2 });
    await expectActiveProjectRemainsPortable(storage, assetFactory);
  });

  it("copies and verifies legacy cloud assets under immutable hashes before activation", async () => {
    const events: string[] = [];
    const legacy = publicProject({
      id: "default",
      name: "Legacy Cloud Project",
      revision: 7,
      legacy: true,
      assets: [{ name: "art", mime: "image/png", size: 3, hash: "11".repeat(32) }],
    });
    const h = harness({
      probeSession: async () => "admin",
      listCloud: async () => [{
        id: "default",
        name: legacy.name,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        readable: true,
      }],
      getCloud: async () => legacy,
      downloadCloudAsset: async (id, entry, isLegacy) => {
        events.push(`download:${id}:${entry.name}:${isLegacy}`);
        return art;
      },
      uploadCloudAsset: async (id, record) => {
        events.push(`copy:${id}:${record.name}`);
        return legacy.assets[0]!;
      },
    });

    await h.controller.start();
    await h.controller.openCloudProject(h.lifecycle.getSnapshot().cloudProjects[0]!);

    expect(events).toEqual(["download:default:art:true", "copy:default:art"]);
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: { id: "default", location: "cloud", revision: 7 },
    });
    await expectActiveProjectRemainsPortable(h.storage, h.assetFactory);
  });

  it("opens a grandfathered legacy cloud asset that cannot enter the new upload path", async () => {
    const empty: StoredAsset = { name: "empty", mime: "image/png", bytes: new Uint8Array() };
    const uploadCloudAsset = vi.fn(async (_id: string, record: StoredAsset) => ({
      name: record.name,
      mime: record.mime,
      size: 0,
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }));
    const legacy = publicProject({
      id: "default",
      name: "Legacy Cloud Project",
      revision: 7,
      legacy: true,
      assets: [{ name: "empty", mime: "image/png", size: 0, hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }],
    });
    const h = harness({
      probeSession: async () => "admin",
      listCloud: async () => [{
        id: "default",
        name: legacy.name,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        readable: true,
      }],
      getCloud: async () => legacy,
      downloadCloudAsset: async () => empty,
      uploadCloudAsset,
    });

    await h.controller.start();
    await h.controller.openCloudProject(h.lifecycle.getSnapshot().cloudProjects[0]!);

    expect(uploadCloudAsset).not.toHaveBeenCalled();
    expect(h.lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: { id: "default", location: "cloud" },
    });
    await expectActiveProjectRemainsPortable(h.storage, h.assetFactory);
  });
});
