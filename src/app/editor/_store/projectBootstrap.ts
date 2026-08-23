/**
 * The single startup authority for the named-project editor (DESIGN ◆53).
 *
 * This controller deliberately sits in front of the editor store, project
 * records, IndexedDB assets, and cloud transport. It stages and verifies both
 * content and assets before changing the active-project pointer; only then is
 * the stable editor/asset singleton updated and made visible by PanelLayout.
 */

import {
  assetLibrariesEqual,
  assetStore,
  bindAssetStoreToProject,
  createInMemoryAssetAdapter,
  createInMemoryAssetMigrationStateStore,
  createInMemoryProjectAssetAdapterFactory,
  createIndexedDbAssetAdapter,
  createIndexedDbAssetMigrationStateStore,
  createProjectScopedIndexedDbAssetAdapter,
  isLegacyCompatibleAsset,
  isSupportedAssetMime,
  isValidAssetName,
  migrateLegacyAssetsToProject,
  ASSET_MAX_BYTES,
  ASSET_MAX_NAME_LENGTH,
  type AssetAdapter,
  type AssetMigrationStateStore,
  type AssetStore,
  type ProjectAssetAdapterFactory,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";
import {
  editorStore,
  type EditorSeed,
  type EditorStore,
} from "@/app/editor/_store/editorStore";
import {
  createBrowserProjectId,
  createProjectRecordSession,
  discoverLegacyProject,
  projectRecordStorageKey,
  readActiveProjectPointer,
  readBrowserProjectRecord,
  readProjectRecord,
  serializeProjectRecord,
  stageLegacyBrowserProjectMigration,
  stageProjectRecord,
  commitStagedProjectRecord,
  updateProjectRecord,
  type LegacyProjectDiscovery,
  type ProjectRecord,
  type ProjectRecordSession,
  type ProjectRecordStorage,
  type StagedProjectRecord,
} from "@/app/editor/_store/projectRepository";
import {
  projectLifecycle,
  type BrowserRecoverySummary,
  type CloudProjectSummary,
  type ProjectLifecycleController,
  type ProjectNameResult,
} from "@/app/editor/_store/projectLifecycle";
import type { ParsedProjectFile } from "@/app/editor/_lib/projectFileFormat";
import {
  createNamedCloudProject,
  downloadNamedProjectAsset,
  getNamedCloudProject,
  listNamedCloudProjects,
  probeProjectSession,
  ProjectCloudClientError,
  updateNamedCloudProject,
  uploadNamedProjectAsset,
} from "@/app/editor/_lib/namedCloudClient";
import {
  getStarterProject,
  type StarterProjectId,
} from "@/app/editor/_lib/starterProjects";
import { sheetsToPersisted } from "@/app/editor/_store/sheetsPayload";
import type {
  NamedCloudProjectContent,
  PublicNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";
import type { CloudAssetManifestEntry } from "@/lib/cloud/projectPayload";
import type { AssetVerificationSubmission } from "@/lib/cloud/namedProjectAsset";
import {
  ADMIN_AUTH_EVENT_CHANNEL,
  ADMIN_AUTH_EVENT_STORAGE_KEY,
  isAdminSignedOutEvent,
} from "@/lib/cloud/authEvents";
import {
  createNamedProjectSyncController,
  type NamedProjectSyncController,
  type NamedProjectSyncSnapshot,
} from "@/app/editor/_store/namedProjectSync";

export const PROJECT_AUTOSAVE_DEBOUNCE_MS = 1000;
export const PROJECT_ASSET_TRANSFER_CONCURRENCY = 8;

export interface ProjectOpenConflict {
  projectId: string;
  browserName: string;
  cloudName: string;
}

export interface ProjectBootstrapSnapshot {
  conflict: ProjectOpenConflict | null;
  cloudSync: NamedProjectSyncSnapshot | null;
}

interface BrowserRecovery {
  summary: BrowserRecoverySummary;
  kind: "current" | "legacy";
  record: ProjectRecord | null;
  legacy: LegacyProjectDiscovery | null;
}

interface PendingCloudOpen {
  operation: number;
  remote: PublicNamedCloudProject;
  remoteAssets: StoredAsset[];
  cached: ProjectRecord;
  cachedAssets: StoredAsset[];
  remoteAssetVerification?: readonly AssetVerificationSubmission[];
}

interface PreparedCloudAssets {
  assets: CloudAssetManifestEntry[];
  assetVerification: AssetVerificationSubmission[];
}

interface PendingCloudCreate {
  sourceKey: string;
  id: string;
  idempotencyToken: string;
  /** Frozen revision-1 name: Retry must reproduce the exact creation
   * fingerprint even when the user edits the field after an ambiguous save. */
  name: string;
  /** Latest requested name, applied as a revision-checked rename only after
   * the original idempotent creation is read back. */
  desiredName: string;
  starterId?: StarterProjectId;
  seed: EditorSeed;
  assets: StoredAsset[];
}

export interface ProjectActivation {
  record: ProjectRecord;
  session: ProjectRecordSession;
  assets: readonly StoredAsset[];
  cloudManifest?: readonly CloudAssetManifestEntry[];
  assetVerification?: readonly AssetVerificationSubmission[];
  starterId?: StarterProjectId;
}

export interface ProjectBootstrapDependencies {
  lifecycle: ProjectLifecycleController;
  editor: EditorStore;
  assets: AssetStore;
  storage: ProjectRecordStorage;
  projectAssetFactory: ProjectAssetAdapterFactory;
  legacyAssetAdapter: AssetAdapter;
  migrationState: AssetMigrationStateStore;
  bindAssets(projectId: string, records: readonly StoredAsset[]): void;
  markAutosaveDisabled(): void;
  randomUuid(): string;
  probeSession(): Promise<"admin" | "anonymous">;
  listCloud(): Promise<CloudProjectSummary[]>;
  getCloud(id: string): Promise<PublicNamedCloudProject>;
  createCloud(request: Parameters<typeof createNamedCloudProject>[0]): Promise<PublicNamedCloudProject>;
  updateCloud(
    id: string,
    baseRevision: number,
    project: NamedCloudProjectContent,
    assetVerification?: readonly AssetVerificationSubmission[],
  ): Promise<{ revision: number; updatedAt: string }>;
  uploadCloudAsset(
    projectId: string,
    asset: StoredAsset,
  ): ReturnType<typeof uploadNamedProjectAsset>;
  downloadCloudAsset(
    projectId: string,
    entry: PublicNamedCloudProject["assets"][number],
    legacy: boolean,
  ): Promise<StoredAsset>;
  /** Drain fallible work for the outgoing project without detaching it. A
   * false result blocks the switch and leaves the old project authoritative. */
  beforeActivate?(): boolean | void | Promise<boolean | void>;
  /** Synchronous teardown performed only after the drain and operation guard
   * both succeed, immediately before the pointer/editor commit. */
  detachBeforeActivate?(): void;
  onActivated?(activation: ProjectActivation): void;
}

export interface ProjectBootstrapController {
  getSnapshot(): ProjectBootstrapSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  retrySession(): Promise<void>;
  retryCloudList(): Promise<void>;
  continueBrowserProject(): Promise<void>;
  createFromStarter(id: StarterProjectId, name: string): Promise<void>;
  openImportedProject(project: ParsedProjectFile, name: string, sourceKey: string): Promise<void>;
  openCloudProject(project: CloudProjectSummary): Promise<void>;
  resolveCloudConflict(choice: "browser" | "cloud"): Promise<void>;
  openChooser(): void;
  cancelChooser(): void;
  renameActiveProject(name: string): ProjectNameResult;
  retryCloudSync(): Promise<boolean>;
  flushLocal(): void;
  getActiveSession(): ProjectRecordSession | null;
  dispose(): void;
}

function cloneAsset(asset: StoredAsset): StoredAsset {
  return {
    name: asset.name,
    mime: asset.mime,
    bytes: asset.bytes instanceof Blob ? asset.bytes : asset.bytes.slice(),
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Write-before-delete and full readback. A failure leaves an inactive,
 * recoverable namespace; callers must not commit the project pointer. */
export async function stageExactProjectAssets(
  adapter: AssetAdapter,
  records: readonly StoredAsset[],
): Promise<StoredAsset[]> {
  const names = new Set<string>();
  for (const record of records) {
    if (!isLegacyCompatibleAsset(record) || names.has(record.name)) {
      throw new Error("Project assets are invalid or contain duplicate names.");
    }
    names.add(record.name);
  }
  const current = await adapter.list();
  for (const record of records) await adapter.put(cloneAsset(record));
  for (const record of current) {
    if (!names.has(record.name)) await adapter.delete(record.name);
  }
  const readBack = await adapter.list();
  if (!(await assetLibrariesEqual(records, readBack))) {
    throw new Error("Project assets could not be verified after writing.");
  }
  return readBack.map(cloneAsset);
}

export function cloudAssetCompatibilityErrors(records: readonly StoredAsset[]): string[] {
  const errors: string[] = [];
  for (const record of records) {
    const size = record.bytes instanceof Blob ? record.bytes.size : record.bytes.byteLength;
    const reasons: string[] = [];
    if (!isValidAssetName(record.name)) reasons.push("invalid name");
    else if (record.name.length > ASSET_MAX_NAME_LENGTH) reasons.push("name exceeds 100 characters");
    if (!isSupportedAssetMime(record.mime)) reasons.push(`unsupported MIME ${record.mime}`);
    if (size === 0) reasons.push("zero bytes");
    else if (size > ASSET_MAX_BYTES) reasons.push("exceeds 2 MB");
    if (reasons.length > 0) errors.push(`${record.name}: ${reasons.join(", ")}`);
  }
  return errors;
}

function sameSeed(a: EditorSeed, b: EditorSeed): boolean {
  return a.code === b.code &&
    JSON.stringify(sheetsToPersisted(a.sheets)) === JSON.stringify(sheetsToPersisted(b.sheets));
}

function stagedFromExisting(record: ProjectRecord): StagedProjectRecord {
  return {
    record,
    storageKey: projectRecordStorageKey(record),
    serialized: serializeProjectRecord(record),
  };
}

function safeOpenError(error: unknown): string {
  if (error instanceof ProjectCloudClientError) return error.message;
  return "The project could not be opened without risking the current project. Please retry.";
}

export function createProjectBootstrapController(
  dependencies: ProjectBootstrapDependencies,
): ProjectBootstrapController {
  const deps = dependencies;
  let snapshot: ProjectBootstrapSnapshot = { conflict: null, cloudSync: null };
  const listeners = new Set<() => void>();
  let recovery: BrowserRecovery | null = null;
  let pendingCloudOpen: PendingCloudOpen | null = null;
  let pendingCloudCreate: PendingCloudCreate | null = null;
  let activeSession: ProjectRecordSession | null = null;
  let editorUnsubscribe: (() => void) | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const publish = (next: ProjectBootstrapSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const clearAutosaveTimer = (): void => {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveTimer = null;
  };

  const flushActiveLocal = (): boolean => {
    clearAutosaveTimer();
    if (activeSession === null || !activeSession.getSnapshot().dirty) return true;
    try {
      activeSession.flush();
      return true;
    } catch {
      deps.markAutosaveDisabled();
      return false;
    }
  };

  const flushLocal = (): void => { flushActiveLocal(); };

  const detachLocalSession = (): void => {
    clearAutosaveTimer();
    editorUnsubscribe?.();
    editorUnsubscribe = null;
    activeSession = null;
  };

  const attachLocalSession = (
    record: ProjectRecord,
    records: readonly StoredAsset[],
    cloudManifest?: readonly CloudAssetManifestEntry[],
    starterId?: StarterProjectId,
    assetVerification?: readonly AssetVerificationSubmission[],
  ): void => {
    if (activeSession !== null || editorUnsubscribe !== null) {
      throw new Error("The outgoing project session was not detached.");
    }
    activeSession = createProjectRecordSession(deps.storage, record);
    editorUnsubscribe = deps.editor.subscribe((state, previous) => {
      if (state.code === previous.code && state.sheets === previous.sheets) return;
      activeSession?.replaceSeed({ code: state.code, sheets: state.sheets });
      clearAutosaveTimer();
      autosaveTimer = setTimeout(flushLocal, PROJECT_AUTOSAVE_DEBOUNCE_MS);
    });
    deps.onActivated?.({
      record,
      session: activeSession,
      assets: records,
      ...(cloudManifest === undefined ? {} : { cloudManifest }),
      ...(starterId === undefined ? {} : { starterId }),
      ...(assetVerification === undefined ? {} : { assetVerification }),
    });
  };

  const stageOrUpdateRecord = (record: ProjectRecord): StagedProjectRecord => {
    const existing = readProjectRecord(deps.storage, record);
    if (existing === null) return stageProjectRecord(deps.storage, record);
    if (serializeProjectRecord(existing) === serializeProjectRecord(record)) {
      return stagedFromExisting(existing);
    }
    return stagedFromExisting(updateProjectRecord(deps.storage, record));
  };

  const isCurrentOpenOperation = (operation: number): boolean => {
    const current = deps.lifecycle.getSnapshot();
    return current.operation === operation &&
      (current.phase === "opening" || current.phase === "creating-cloud-project");
  };

  const activate = async (
    operation: number,
    record: ProjectRecord,
    records: readonly StoredAsset[],
    pointerAlreadyActive = false,
    cloudManifest?: readonly CloudAssetManifestEntry[],
    starterId?: StarterProjectId,
    assetVerification?: readonly AssetVerificationSubmission[],
  ): Promise<boolean> => {
    if (!isCurrentOpenOperation(operation)) return false;
    const adapter = deps.projectAssetFactory(record.id);
    const verifiedAssets = await stageExactProjectAssets(adapter, records);
    if (!isCurrentOpenOperation(operation)) return false;
    if (!flushActiveLocal()) {
      throw new ProjectCloudClientError(
        "unavailable",
        "The current browser draft could not be saved. Retry before switching projects.",
      );
    }
    const drained = await deps.beforeActivate?.();
    if (drained === false) {
      throw new ProjectCloudClientError(
        "unavailable",
        "The current cloud project could not be saved. Retry before switching projects.",
      );
    }
    if (!isCurrentOpenOperation(operation)) return false;

    // Complete every fallible storage operation while the outgoing editor and
    // its subscriptions are still authoritative. A quota/pointer failure can
    // then leave that project fully usable without a rollback write.
    const outgoingPointer = readActiveProjectPointer(deps.storage);
    const targetIsOutgoing = outgoingPointer?.location === record.location &&
      outgoingPointer.id === record.id;
    if (!pointerAlreadyActive && record.location === "cloud" && outgoingPointer?.location === "browser") {
      const outgoingBrowser = readProjectRecord(deps.storage, outgoingPointer);
      if (outgoingBrowser !== null) {
        commitStagedProjectRecord(deps.storage, stagedFromExisting(outgoingBrowser));
      }
    }
    const staged = pointerAlreadyActive
      ? stagedFromExisting(record)
      : stageOrUpdateRecord(record);
    // Reopening the currently active cloud identity already wrote and verified
    // its record; its unchanged pointer needs no second fallible write. The
    // startup browser-upgrade path has no attached session and still commits
    // so it can create BROWSER_PROJECT_POINTER_KEY.
    if (!targetIsOutgoing || activeSession === null || record.location === "browser") {
      commitStagedProjectRecord(deps.storage, staged);
    }

    // From this point onward the switch is a synchronous, validated in-memory
    // bind. These hooks are deliberately specified as no-throw finalizers.
    detachLocalSession();
    deps.detachBeforeActivate?.();
    deps.bindAssets(record.id, verifiedAssets);
    deps.editor.getState().replaceProject(record.seed);
    attachLocalSession(record, verifiedAssets, cloudManifest, starterId, assetVerification);
    if (record.location === "browser") {
      recovery = {
        kind: "current",
        record,
        legacy: null,
        summary: { id: record.id, name: record.name, assetsOnly: false },
      };
    }
    pendingCloudOpen = null;
    publish({ ...snapshot, conflict: null });
    deps.lifecycle.completeOpen(operation, {
      location: record.location,
      id: record.id,
      name: record.name,
      revision: record.revision,
    });
    return true;
  };

  const discoverBrowser = async (): Promise<BrowserRecovery | null> => {
    const active = readBrowserProjectRecord(deps.storage);
    if (active !== null) {
      return {
        kind: "current",
        record: active,
        legacy: null,
        summary: { id: active.id, name: active.name, assetsOnly: false },
      };
    }
    const legacy = discoverLegacyProject(deps.storage);
    let assetCount = 0;
    try {
      assetCount = (await deps.legacyAssetAdapter.list()).length;
    } catch {
      // If IndexedDB itself is unavailable, bootstrap can still recover the
      // legacy content record and will report the asset failure on open.
    }
    if (legacy.status === "missing" && assetCount === 0) return null;
    return {
      kind: "legacy",
      record: null,
      legacy,
      summary: {
        id: "browser-legacy-v1",
        name: "Browser Project",
        assetsOnly: legacy.status !== "valid" && assetCount > 0,
      },
    };
  };

  const loadCloudList = async (): Promise<void> => {
    const operation = deps.lifecycle.beginCloudList();
    if (operation === null) return;
    try {
      deps.lifecycle.resolveCloudList(operation, await deps.listCloud());
    } catch {
      deps.lifecycle.failCloudList(operation, "Could not load cloud projects. Please retry.");
    }
  };

  const checkSession = async (): Promise<void> => {
    const operation = deps.lifecycle.beginSessionCheck();
    try {
      const [role, foundRecovery] = await Promise.all([
        deps.probeSession(),
        discoverBrowser(),
      ]);
      if (disposed) return;
      const current = deps.lifecycle.getSnapshot();
      if (current.operation !== operation || current.phase !== "checking-session") return;
      recovery = foundRecovery;
      if (role === "anonymous") {
        deps.lifecycle.resolveAnonymous(operation, recovery?.summary ?? null);
      } else {
        deps.lifecycle.resolveAdmin(operation, recovery?.summary ?? null);
        await loadCloudList();
      }
    } catch {
      deps.lifecycle.failSessionCheck(
        operation,
        "Could not check the admin session. Please retry or open Admin.",
      );
    }
  };

  const downloadCloudAssets = async (project: PublicNamedCloudProject): Promise<StoredAsset[]> =>
    mapWithConcurrency(
      project.assets,
      PROJECT_ASSET_TRANSFER_CONCURRENCY,
      (entry) => deps.downloadCloudAsset(project.id, entry, project.legacy),
    );

  const manifestForAssets = async (
    projectId: string,
    records: readonly StoredAsset[],
  ): Promise<PreparedCloudAssets> => {
    const errors = cloudAssetCompatibilityErrors(records);
    if (errors.length > 0) {
      throw new ProjectCloudClientError(
        "invalid-response",
        `These assets cannot sync to cloud: ${errors.join("; ")}.`,
      );
    }
    const uploaded = await mapWithConcurrency(
      records,
      PROJECT_ASSET_TRANSFER_CONCURRENCY,
      (record) => deps.uploadCloudAsset(projectId, record),
    );
    return {
      assets: uploaded.map(({ name, mime, size, hash }) => ({ name, mime, size, hash })),
      assetVerification: uploaded.flatMap(({ name, verificationReceipt }) =>
        verificationReceipt === undefined ? [] : [{ name, receipt: verificationReceipt }]),
    };
  };

  const createCloudAndActivate = async (
    operation: number,
    pending: PendingCloudCreate,
  ): Promise<void> => {
    const prepared = await manifestForAssets(pending.id, pending.assets);
    if (!isCurrentOpenOperation(operation)) return;
    const created = await deps.createCloud({
      id: pending.id,
      idempotencyToken: pending.idempotencyToken,
      project: {
        name: pending.name,
        ...(pending.starterId === undefined ? {} : { starterId: pending.starterId }),
        code: pending.seed.code,
        sheets: pending.seed.sheets,
        assets: prepared.assets,
      },
      ...(prepared.assetVerification.length === 0
        ? {}
        : { assetVerification: prepared.assetVerification }),
    });
    if (!isCurrentOpenOperation(operation)) return;
    // A separate read closes the "successful response but wrong object"
    // ambiguity before any local pointer changes.
    let verified = await deps.getCloud(created.id);
    if (verified.name !== pending.desiredName) {
      await deps.updateCloud(verified.id, verified.revision, {
        name: pending.desiredName,
        ...(verified.starterId === undefined ? {} : { starterId: verified.starterId }),
        code: verified.code,
        sheets: verified.sheets,
        assets: verified.assets,
      });
      verified = await deps.getCloud(created.id);
      if (verified.name !== pending.desiredName) {
        throw new ProjectCloudClientError(
          "invalid-response",
          "The cloud project rename could not be verified. Please retry.",
        );
      }
    }
    const activated = await activate(operation, {
      location: "cloud",
      id: verified.id,
      name: verified.name,
      revision: verified.revision,
      seed: { code: verified.code, sheets: verified.sheets },
    }, pending.assets, false, verified.assets, verified.starterId);
    if (activated && pendingCloudCreate === pending) pendingCloudCreate = null;
  };

  const openSeed = async (
    operation: number,
    role: "anonymous" | "admin",
    seed: EditorSeed,
    assets: readonly StoredAsset[],
    name: string,
    sourceKey: string,
    starterId?: StarterProjectId,
  ): Promise<void> => {
    try {
      if (!isCurrentOpenOperation(operation)) return;
      if (role === "admin") {
        if (pendingCloudCreate?.sourceKey !== sourceKey) {
          pendingCloudCreate = {
            sourceKey,
            id: deps.randomUuid(),
            idempotencyToken: `${deps.randomUuid()}${deps.randomUuid()}`.replaceAll("-", ""),
            name,
            desiredName: name,
            ...(starterId === undefined ? {} : { starterId }),
            seed,
            assets: assets.map(cloneAsset),
          };
        } else {
          pendingCloudCreate.desiredName = name;
        }
        await createCloudAndActivate(operation, pendingCloudCreate);
      } else {
        const id = createBrowserProjectId(deps.randomUuid);
        await activate(operation, {
          location: "browser",
          id,
          name,
          revision: null,
          seed,
        }, assets);
      }
    } catch (error) {
      deps.lifecycle.failOpen(operation, safeOpenError(error));
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: checkSession,
    retrySession: checkSession,
    retryCloudList: loadCloudList,

    continueBrowserProject: async () => {
      const current = deps.lifecycle.getSnapshot();
      if (
        recovery?.kind === "current" &&
        current.activeProject?.location === "browser" &&
        current.activeProject.id === recovery.summary.id
      ) {
        pendingCloudOpen = null;
        pendingCloudCreate = null;
        publish({ ...snapshot, conflict: null });
        deps.lifecycle.cancelChooser();
        return;
      }
      const operation = deps.lifecycle.beginOpen("open");
      try {
        if (recovery === null) throw new Error("No browser project is available.");
        if (recovery.kind === "current" && recovery.record !== null) {
          const browser = readBrowserProjectRecord(deps.storage);
          const pointer = readActiveProjectPointer(deps.storage);
          if (
            browser === null ||
            browser.id !== recovery.record.id
          ) {
            throw new Error("The browser project changed. Retry discovery.");
          }
          const records = await deps.projectAssetFactory(browser.id).list();
          const pointerAlreadyActive = pointer?.location === "browser" &&
            pointer.id === browser.id;
          await activate(operation, browser, records, pointerAlreadyActive);
          return;
        }
        if (recovery.legacy === null) throw new Error("Legacy recovery is unavailable.");
        const staged = stageLegacyBrowserProjectMigration(deps.storage, recovery.legacy);
        const destination = deps.projectAssetFactory(staged.record.id);
        const migrated = await migrateLegacyAssetsToProject({
          projectId: staged.record.id,
          source: deps.legacyAssetAdapter,
          destination,
          state: deps.migrationState,
        });
        await activate(operation, staged.record, migrated.records);
      } catch (error) {
        deps.lifecycle.failOpen(operation, safeOpenError(error));
      }
    },

    createFromStarter: async (id, name) => {
      const role = deps.lifecycle.getSnapshot().role;
      if (role !== "anonymous" && role !== "admin") return;
      const operation = deps.lifecycle.beginOpen(role === "admin" ? "create-cloud" : "open");
      try {
        const starter = getStarterProject(id);
        if (!starter.available) throw new Error("That starter project is not installed yet.");
        const loaded = await starter.load();
        await openSeed(
          operation,
          role,
          loaded.seed,
          loaded.assets,
          name,
          `starter:${id}`,
          id,
        );
      } catch (error) {
        deps.lifecycle.failOpen(operation, safeOpenError(error));
      }
    },

    openImportedProject: async (project, name, sourceKey) => {
      const role = deps.lifecycle.getSnapshot().role;
      if (role !== "anonymous" && role !== "admin") return;
      const operation = deps.lifecycle.beginOpen(role === "admin" ? "create-cloud" : "open");
      await openSeed(
        operation,
        role,
        project.seed,
        project.assets,
        name,
        `import:${sourceKey}`,
      );
    },

    openCloudProject: async (summary) => {
      if (!summary.readable) return;
      const active = deps.lifecycle.getSnapshot().activeProject;
      if (active?.location === "cloud" && active.id === summary.id) {
        deps.lifecycle.cancelChooser();
        return;
      }
      const operation = deps.lifecycle.beginOpen("open");
      try {
        const remote = await deps.getCloud(summary.id);
        const remoteAssets = await downloadCloudAssets(remote);
        let remoteAssetVerification: readonly AssetVerificationSubmission[] | undefined;
        // The deployed `default` project names asset objects by logical name.
        // Copy and verify every byte under its immutable hash key before any
        // later revision write can upgrade the manifest to v2. The old objects
        // remain untouched and recoverable.
        if (remote.legacy && cloudAssetCompatibilityErrors(remoteAssets).length === 0) {
          remoteAssetVerification = (await manifestForAssets(remote.id, remoteAssets))
            .assetVerification;
        }
        if (!isCurrentOpenOperation(operation)) return;
        const cached = readProjectRecord(deps.storage, { location: "cloud", id: remote.id });
        if (cached !== null) {
          const cachedAssets = await deps.projectAssetFactory(remote.id).list();
          const differs = cached.name !== remote.name ||
            !sameSeed(cached.seed, { code: remote.code, sheets: remote.sheets }) ||
            !(await assetLibrariesEqual(cachedAssets, remoteAssets));
          if (differs) {
            if (!isCurrentOpenOperation(operation)) return;
            pendingCloudOpen = {
              operation,
              remote,
              remoteAssets,
              cached,
              cachedAssets,
              ...(remoteAssetVerification === undefined ? {} : { remoteAssetVerification }),
            };
            publish({
              ...snapshot,
              conflict: {
                projectId: remote.id,
                browserName: cached.name,
                cloudName: remote.name,
              },
            });
            deps.lifecycle.failOpen(
              operation,
              "This browser has a different cached copy. Choose which copy to keep.",
            );
            return;
          }
        }
        await activate(operation, {
          location: "cloud",
          id: remote.id,
          name: remote.name,
          revision: remote.revision,
          seed: { code: remote.code, sheets: remote.sheets },
        }, remoteAssets, false, remote.assets, remote.starterId, remoteAssetVerification);
      } catch (error) {
        deps.lifecycle.failOpen(operation, safeOpenError(error));
      }
    },

    resolveCloudConflict: async (choice) => {
      const conflict = pendingCloudOpen;
      if (conflict === null) return;
      const operation = deps.lifecycle.beginOpen("open");
      try {
        if (choice === "cloud") {
          await activate(operation, {
            location: "cloud",
            id: conflict.remote.id,
            name: conflict.remote.name,
            revision: conflict.remote.revision,
            seed: { code: conflict.remote.code, sheets: conflict.remote.sheets },
          }, conflict.remoteAssets, false, conflict.remote.assets, conflict.remote.starterId,
          conflict.remoteAssetVerification);
          return;
        }
        const prepared = await manifestForAssets(conflict.cached.id, conflict.cachedAssets);
        if (!isCurrentOpenOperation(operation)) return;
        const saved = await deps.updateCloud(
          conflict.remote.id,
          conflict.remote.revision,
          {
            name: conflict.cached.name,
            code: conflict.cached.seed.code,
            sheets: conflict.cached.seed.sheets,
            assets: prepared.assets,
          },
          prepared.assetVerification,
        );
        if (!isCurrentOpenOperation(operation)) return;
        await activate(operation, {
          ...conflict.cached,
          revision: saved.revision,
        }, conflict.cachedAssets, false, prepared.assets);
      } catch (error) {
        deps.lifecycle.failOpen(operation, safeOpenError(error));
      }
    },

    openChooser: () => {
      flushLocal();
      pendingCloudOpen = null;
      pendingCloudCreate = null;
      publish({ ...snapshot, conflict: null });
      deps.lifecycle.openChooser();
      if (deps.lifecycle.getSnapshot().role === "admin") void loadCloudList();
    },
    cancelChooser: () => {
      pendingCloudOpen = null;
      pendingCloudCreate = null;
      publish({ ...snapshot, conflict: null });
      deps.lifecycle.cancelChooser();
    },
    renameActiveProject: (name) => {
      if (activeSession === null) return deps.lifecycle.renameActiveProject(name);
      const result = activeSession.rename(name);
      if (!result.ok) return result;
      try {
        activeSession.flush();
      } catch {
        deps.markAutosaveDisabled();
        return { ok: false, name: "", error: "The project name could not be saved locally." };
      }
      deps.lifecycle.renameActiveProject(result.name);
      return result;
    },
    retryCloudSync: async () => false,
    flushLocal,
    getActiveSession: () => activeSession,
    dispose: () => {
      disposed = true;
      flushLocal();
      editorUnsubscribe?.();
      editorUnsubscribe = null;
      listeners.clear();
    },
  };
}

class MemoryProjectStorage implements ProjectRecordStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/** Browser-only factory. Merely importing this module performs no browser I/O. */
export function createBrowserProjectBootstrap(
  onActivated?: ProjectBootstrapDependencies["onActivated"],
): ProjectBootstrapController {
  let storage: ProjectRecordStorage;
  let persistentStorage = true;
  try {
    const candidate = window.localStorage;
    // Access can succeed while writes throw in hardened/private modes. Probe
    // one dedicated key and restore its prior state exactly.
    const probeKey = "cardgoblin.project-storage-probe";
    const prior = candidate.getItem(probeKey);
    candidate.setItem(probeKey, "1");
    if (candidate.getItem(probeKey) !== "1") throw new Error("storage probe failed");
    if (prior === null) candidate.removeItem(probeKey);
    else candidate.setItem(probeKey, prior);
    storage = candidate;
  } catch {
    storage = new MemoryProjectStorage();
    persistentStorage = false;
  }

  const hasIndexedDb = typeof indexedDB !== "undefined";
  const inMemoryFactory = createInMemoryProjectAssetAdapterFactory();
  const projectAssetFactory = hasIndexedDb
    ? createProjectScopedIndexedDbAssetAdapter
    : inMemoryFactory;
  const legacyAssetAdapter = hasIndexedDb
    ? createIndexedDbAssetAdapter()
    : createInMemoryAssetAdapter();
  const migrationState = hasIndexedDb
    ? createIndexedDbAssetMigrationStateStore()
    : createInMemoryAssetMigrationStateStore();

  if (!persistentStorage) editorStore.setState({ autosaveDisabled: true });
  let activeSync: NamedProjectSyncController | null = null;
  let syncUnsubscribe: (() => void) | null = null;
  let publishOuter = (): void => {};

  const controller = createProjectBootstrapController({
    lifecycle: projectLifecycle,
    editor: editorStore,
    assets: assetStore,
    storage,
    projectAssetFactory,
    legacyAssetAdapter,
    migrationState,
    bindAssets: (projectId, records) => bindAssetStoreToProject({
      projectId,
      records,
      adapterFactory: projectAssetFactory,
      startDisabled: !hasIndexedDb,
    }),
    markAutosaveDisabled: () => editorStore.setState({ autosaveDisabled: true }),
    randomUuid: () => crypto.randomUUID(),
    probeSession: () => probeProjectSession(),
    listCloud: () => listNamedCloudProjects(),
    getCloud: (id) => getNamedCloudProject(id),
    createCloud: (request) => createNamedCloudProject(request),
    updateCloud: (id, revision, project, assetVerification = []) =>
      updateNamedCloudProject(id, revision, project, fetch, assetVerification),
    uploadCloudAsset: (id, record) => uploadNamedProjectAsset(id, record),
    downloadCloudAsset: (id, entry, legacy) =>
      downloadNamedProjectAsset(id, entry, legacy),
    beforeActivate: async () => {
      if (activeSync === null) return true;
      return activeSync.flush();
    },
    detachBeforeActivate: () => {
      syncUnsubscribe?.();
      syncUnsubscribe = null;
      activeSync?.destroy();
      activeSync = null;
    },
    onActivated: (activation) => {
      if (
        activation.record.location === "cloud" &&
        activation.record.revision !== null
      ) {
        activeSync = createNamedProjectSyncController({
          projectId: activation.record.id,
          baseRevision: activation.record.revision,
          editor: editorStore,
          projectSession: activation.session,
          assets: assetStore,
          ...(activation.starterId === undefined
            ? {}
            : { starterId: activation.starterId }),
          ...(activation.cloudManifest === undefined
            ? {}
            : { initialAssetManifest: activation.cloudManifest }),
          ...(activation.assetVerification === undefined
            ? {}
            : { initialAssetVerification: activation.assetVerification }),
        });
        syncUnsubscribe = activeSync.subscribe(() => {
          const sync = activeSync?.getSnapshot();
          if (sync !== undefined) projectLifecycle.setActiveCloudRevision(sync.revision);
          publishOuter();
        });
      }
      publishOuter();
      onActivated?.(activation);
    },
  });

  const pagehide = (): void => {
    controller.flushLocal();
    void activeSync?.flush();
  };
  const visibilityChange = (): void => {
    if (document.visibilityState === "hidden") pagehide();
  };
  window.addEventListener("pagehide", pagehide);
  document.addEventListener("visibilitychange", visibilityChange);
  const sessionEnded = (): void => {
    activeSync?.sessionEnded();
    publishOuter();
  };
  const storageEvent = (event: StorageEvent): void => {
    if (
      event.key === ADMIN_AUTH_EVENT_STORAGE_KEY &&
      isAdminSignedOutEvent(event.newValue)
    ) sessionEnded();
  };
  window.addEventListener("storage", storageEvent);
  let authChannel: BroadcastChannel | null = null;
  try {
    authChannel = new BroadcastChannel(ADMIN_AUTH_EVENT_CHANNEL);
    authChannel.addEventListener("message", (event) => {
      if (isAdminSignedOutEvent(event.data)) sessionEnded();
    });
  } catch {
    authChannel = null;
  }
  let outerSnapshot: ProjectBootstrapSnapshot = controller.getSnapshot();
  const outerListeners = new Set<() => void>();
  publishOuter = () => {
    const base = controller.getSnapshot();
    const cloudSync = activeSync?.getSnapshot() ?? null;
    if (base.conflict === outerSnapshot.conflict && cloudSync === outerSnapshot.cloudSync) return;
    outerSnapshot = { conflict: base.conflict, cloudSync };
    for (const listener of outerListeners) listener();
  };
  const unsubscribeBase = controller.subscribe(publishOuter);
  return {
    ...controller,
    getSnapshot: () => outerSnapshot,
    subscribe: (listener) => {
      outerListeners.add(listener);
      return () => outerListeners.delete(listener);
    },
    retryCloudSync: () => activeSync?.retry() ?? Promise.resolve(false),
    flushLocal: () => {
      controller.flushLocal();
      void activeSync?.flush();
    },
    dispose: () => {
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("storage", storageEvent);
      document.removeEventListener("visibilitychange", visibilityChange);
      authChannel?.close();
      unsubscribeBase();
      syncUnsubscribe?.();
      activeSync?.destroy();
      activeSync = null;
      controller.dispose();
      outerListeners.clear();
    },
  };
}
