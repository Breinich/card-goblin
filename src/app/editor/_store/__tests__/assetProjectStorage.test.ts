import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_NAME_LENGTH,
  LEGACY_BROWSER_ASSET_PROJECT_ID,
  SUPPORTED_ASSET_MIMES,
  assetLibrariesEqual,
  assetStore,
  bindAssetStoreToProject,
  createInMemoryAssetAdapter,
  createInMemoryAssetMigrationStateStore,
  createInMemoryProjectAssetAdapterFactory,
  createProjectScopedAssetStore,
  isLegacyCompatibleAsset,
  isSupportedAssetMime,
  isValidNewAsset,
  migrateLegacyAssetsToProject,
  resetAssetStoreForTests,
  type AssetAdapter,
  type AssetChangeEvent,
  type StoredAsset,
} from "../assetStore";

const png = (name: string, bytes: number[] = [1]): StoredAsset => ({
  name,
  mime: "image/png",
  bytes: new Uint8Array(bytes),
});

afterEach(() => resetAssetStoreForTests());

describe("prospective asset policy", () => {
  it("uses the exact reviewed MIME allowlist", () => {
    expect(SUPPORTED_ASSET_MIMES).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/svg+xml",
    ]);
    for (const mime of SUPPORTED_ASSET_MIMES) expect(isSupportedAssetMime(mime)).toBe(true);
    for (const mime of ["image/x-icon", "image/apng", "image/PNG", "image/png; charset=x", "text/plain"]) {
      expect(isSupportedAssetMime(mime)).toBe(false);
    }
  });

  it("requires identifier names through 100 characters and nonzero bytes through 2 MB", () => {
    const atNameCap = "a".repeat(ASSET_MAX_NAME_LENGTH);
    expect(isValidNewAsset(png(atNameCap))).toBe(true);
    expect(isValidNewAsset(png(`${atNameCap}a`))).toBe(false);
    expect(isValidNewAsset(png("bad-name"))).toBe(false);
    expect(isValidNewAsset(png("empty", []))).toBe(false);
    expect(
      isValidNewAsset({ name: "at_cap", mime: "image/png", bytes: new Uint8Array(ASSET_MAX_BYTES) }),
    ).toBe(true);
    expect(
      isValidNewAsset({
        name: "over_cap",
        mime: "image/png",
        bytes: new Uint8Array(ASSET_MAX_BYTES + 1),
      }),
    ).toBe(false);
  });

  it("project-scoped upload enforces the prospective rules with typed errors", async () => {
    const factory = createInMemoryProjectAssetAdapterFactory();
    const store = createProjectScopedAssetStore("project-a", factory);
    await expect(store.upload("empty", "image/png", new Uint8Array())).rejects.toMatchObject({
      code: "empty",
    });
    await expect(
      store.upload("icon", "image/x-icon", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "invalid-mime" });
    await expect(
      store.upload("a".repeat(ASSET_MAX_NAME_LENGTH + 1), "image/png", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "invalid-name" });
    for (const mime of SUPPORTED_ASSET_MIMES) {
      await expect(store.upload("art", mime, new Uint8Array([1]))).resolves.toMatchObject({ mime });
    }
  });

  it("keeps the existing store factory permissive for v1 callers", async () => {
    const legacy = createInMemoryAssetAdapter();
    const store = (await import("../assetStore")).createAssetStore(legacy);
    await expect(store.upload("icon", "image/x-icon", new Uint8Array())).resolves.toMatchObject({
      size: 0,
    });
    await expect(
      store.upload("a".repeat(ASSET_MAX_NAME_LENGTH + 1), "image/custom", new Uint8Array([1])),
    ).resolves.toBeDefined();
  });

  it("keeps an explicit grandfathered predicate and staging path", async () => {
    const longName = "a".repeat(ASSET_MAX_NAME_LENGTH + 1);
    const legacyRecords: StoredAsset[] = [
      { name: longName, mime: "image/x-icon", bytes: new Uint8Array() },
    ];
    expect(isLegacyCompatibleAsset(legacyRecords[0])).toBe(true);
    expect(isValidNewAsset(legacyRecords[0])).toBe(false);

    const store = createProjectScopedAssetStore(
      "project-a",
      createInMemoryProjectAssetAdapterFactory(),
    );
    await store.replaceAll(legacyRecords);
    expect(await store.getBytes(longName)).toEqual(legacyRecords[0]);
    // Existing grandfathered names can remain unchanged, but a new long name
    // cannot be introduced through rename.
    await expect(store.rename(longName, longName)).resolves.toBeUndefined();
    await expect(store.rename(longName, `${longName}b`)).rejects.toMatchObject({
      code: "invalid-name",
    });
  });
});

describe("project-scoped adapter binding", () => {
  it("isolates identical logical names by immutable project ID", async () => {
    const factory = createInMemoryProjectAssetAdapterFactory();
    const projectA = factory("project-a");
    const projectB = factory("project-b");
    await projectA.put(png("art", [1]));
    await projectB.put(png("art", [2]));

    expect((await projectA.get("art"))?.bytes).toEqual(new Uint8Array([1]));
    expect((await projectB.get("art"))?.bytes).toEqual(new Uint8Array([2]));
    await projectA.rename("art", "renamed");
    expect(await projectA.get("art")).toBeNull();
    expect(await projectB.get("art")).not.toBeNull();
    await projectA.delete("renamed");
    expect((await projectB.list()).map((asset) => asset.name)).toEqual(["art"]);
  });

  it("binds the stable singleton synchronously to verified staged records", async () => {
    const factory = createInMemoryProjectAssetAdapterFactory();
    const adapter = factory("project-a");
    const staged = [png("art", [4, 5])];
    await adapter.put(staged[0]);

    const stableReference = assetStore;
    bindAssetStoreToProject({ projectId: "project-a", records: staged, adapterFactory: factory });
    expect(assetStore).toBe(stableReference);
    expect(assetStore.getSnapshot().assets).toEqual([
      { name: "art", mime: "image/png", size: 2 },
    ]);
    expect((await assetStore.getBytes("art"))?.bytes).toEqual(new Uint8Array([4, 5]));
    await expect(
      assetStore.upload("icon", "image/x-icon", new Uint8Array([1])),
    ).rejects.toMatchObject({ code: "invalid-mime" });
  });

  it("notifies stable-singleton subscribers when a project rebinds with reused names", async () => {
    const factory = createInMemoryProjectAssetAdapterFactory();
    const events: AssetChangeEvent[] = [];
    const unsubscribe = assetStore.subscribe((event) => events.push(event));
    bindAssetStoreToProject({
      projectId: "project-a",
      records: [png("art", [1])],
      adapterFactory: factory,
    });
    bindAssetStoreToProject({
      projectId: "project-b",
      records: [png("art", [2])],
      adapterFactory: factory,
    });
    unsubscribe();

    expect(events).toEqual([{ type: "replaceAll" }, { type: "replaceAll" }]);
  });
});

describe("copy-only legacy asset migration", () => {
  it("copies legacy-compatible records byte-exact, marks only after verification, and never deletes v1", async () => {
    const longName = "a".repeat(ASSET_MAX_NAME_LENGTH + 1);
    const legacyRecords: StoredAsset[] = [
      { name: longName, mime: "image/x-icon", bytes: new Uint8Array() },
      png("dragon", [0, 1, 2, 255]),
    ];
    const source = createInMemoryAssetAdapter(legacyRecords);
    const destination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    const state = createInMemoryAssetMigrationStateStore();

    const result = await migrateLegacyAssetsToProject({ source, destination, state });
    expect(result).toMatchObject({
      status: "migrated",
      projectId: LEGACY_BROWSER_ASSET_PROJECT_ID,
      assetCount: 2,
    });
    expect(await state.getState(LEGACY_BROWSER_ASSET_PROJECT_ID)).toBe("authoritative");
    expect(await assetLibrariesEqual(legacyRecords, await destination.list())).toBe(true);
    expect(await assetLibrariesEqual(legacyRecords, await source.list())).toBe(true);
    expect(result.records[1].bytes).not.toBe(legacyRecords[1].bytes);
  });

  it("is idempotent and performs no destination writes when an authoritative copy verifies", async () => {
    const records = [png("dragon", [1, 2, 3])];
    const source = createInMemoryAssetAdapter(records);
    const baseDestination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    let puts = 0;
    const destination: AssetAdapter = {
      ...baseDestination,
      put: async (record) => {
        puts += 1;
        await baseDestination.put(record);
      },
    };
    const state = createInMemoryAssetMigrationStateStore();
    await migrateLegacyAssetsToProject({ source, destination, state });
    expect(puts).toBe(1);
    const retry = await migrateLegacyAssetsToProject({ source, destination, state });
    expect(retry.status).toBe("already-current");
    expect(puts).toBe(1);
  });

  it("repairs stale destination records and a stale authoritative marker", async () => {
    const source = createInMemoryAssetAdapter([png("dragon", [9])]);
    const destination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    await destination.put(png("dragon", [1]));
    await destination.put(png("stale", [2]));
    const state = createInMemoryAssetMigrationStateStore();
    await state.setState(LEGACY_BROWSER_ASSET_PROJECT_ID, "authoritative");

    const result = await migrateLegacyAssetsToProject({ source, destination, state });
    expect(result.status).toBe("migrated");
    expect(await destination.list()).toEqual([png("dragon", [9])]);
    expect(await state.getState(LEGACY_BROWSER_ASSET_PROJECT_ID)).toBe("authoritative");
  });

  it("leaves a partial destination pending and the complete v1 source untouched on write failure", async () => {
    const records = [png("dragon", [1]), png("imp", [2])];
    const source = createInMemoryAssetAdapter(records);
    const baseDestination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    let puts = 0;
    const destination: AssetAdapter = {
      ...baseDestination,
      put: async (record) => {
        if (puts++ === 1) throw new Error("quota");
        await baseDestination.put(record);
      },
    };
    const state = createInMemoryAssetMigrationStateStore();

    await expect(
      migrateLegacyAssetsToProject({ source, destination, state }),
    ).rejects.toThrow("quota");
    expect(await state.getState(LEGACY_BROWSER_ASSET_PROJECT_ID)).toBe("pending");
    expect((await destination.list()).map((asset) => asset.name)).toEqual(["dragon"]);
    expect(await assetLibrariesEqual(records, await source.list())).toBe(true);
  });

  it("does not copy a corrupt record that is outside even the legacy boundary", async () => {
    const source = createInMemoryAssetAdapter([
      { name: "bad-name", mime: "text/html", bytes: new Uint8Array([1]) },
    ]);
    const destination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    const state = createInMemoryAssetMigrationStateStore();

    await expect(
      migrateLegacyAssetsToProject({ source, destination, state }),
    ).rejects.toThrow(/invalid record/);
    expect(await destination.list()).toEqual([]);
    expect(await state.getState(LEGACY_BROWSER_ASSET_PROJECT_ID)).toBe("pending");
  });

  it("demotes an old marker before reading v1 so even a source-read failure is non-authoritative", async () => {
    const source: AssetAdapter = {
      list: async () => {
        throw new Error("v1 unavailable");
      },
      get: async () => null,
      put: async () => {},
      rename: async () => {},
      delete: async () => {},
    };
    const destination = createInMemoryProjectAssetAdapterFactory()(
      LEGACY_BROWSER_ASSET_PROJECT_ID,
    );
    const state = createInMemoryAssetMigrationStateStore();
    await state.setState(LEGACY_BROWSER_ASSET_PROJECT_ID, "authoritative");

    await expect(
      migrateLegacyAssetsToProject({ source, destination, state }),
    ).rejects.toThrow("v1 unavailable");
    expect(await state.getState(LEGACY_BROWSER_ASSET_PROJECT_ID)).toBe("pending");
  });
});
