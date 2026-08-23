/**
 * Project-scoped cloud autosync (DESIGN ◆53).
 *
 * One controller is constructed for one immutable cloud project ID and one
 * authoritative base revision. It never reads a global/current ID, so a late
 * upload or manifest PUT cannot cross a project switch. Project switching
 * awaits `flush()` and then destroys this controller before binding another.
 */
import type { AssetStore, StoredAsset } from "@/app/editor/_store/assetStore";
import type { EditorSeed, EditorStore, SheetsState } from "@/app/editor/_store/editorStore";
import type { ProjectRecordSession } from "@/app/editor/_store/projectRepository";
import {
  sha256Hex,
  storedAssetBytes,
  updateNamedCloudProject,
  uploadNamedProjectAsset,
  ProjectCloudClientError,
  type VerifiedCloudAssetUpload,
} from "@/app/editor/_lib/namedCloudClient";
import type {
  NamedCloudProjectContent,
  StarterProjectId,
} from "@/lib/cloud/namedProjectPayload";
import type { CloudAssetManifestEntry } from "@/lib/cloud/projectPayload";
import { isValidCloudProjectId } from "@/lib/cloud/projectIdentity";
import type { AssetVerificationSubmission } from "@/lib/cloud/namedProjectAsset";

export const NAMED_PROJECT_SYNC_DEBOUNCE_MS = 10_000;

export type NamedProjectSyncStatus = "idle" | "saving" | "offline" | "conflict" | "signed-out";

export interface NamedProjectSyncSnapshot {
  status: NamedProjectSyncStatus;
  revision: number;
  dirty: boolean;
  lastSyncedAt: number | null;
  /** Fixed user-safe copy; never a reflected transport/provider message. */
  error: string | null;
}

export interface NamedProjectSyncTransport {
  uploadAsset(projectId: string, asset: StoredAsset): Promise<VerifiedCloudAssetUpload>;
  updateProject(
    projectId: string,
    baseRevision: number,
    project: NamedCloudProjectContent,
    assetVerification?: readonly AssetVerificationSubmission[],
  ): Promise<{ revision: number; updatedAt: string }>;
}

export interface NamedProjectSyncOptions {
  projectId: string;
  baseRevision: number;
  editor: EditorStore;
  projectSession: ProjectRecordSession;
  assets: AssetStore;
  /** Origin metadata is immutable after creation. */
  starterId?: StarterProjectId;
  /** Manifest from the coherently opened cloud revision. Reused directly for
   * content-only saves and as the hash baseline after asset changes. */
  initialAssetManifest?: readonly CloudAssetManifestEntry[];
  /** Receipts are normally needed only for the first legacy-v1 upgrade. */
  initialAssetVerification?: readonly AssetVerificationSubmission[];
  transport?: NamedProjectSyncTransport;
  debounceMs?: number;
  now?: () => number;
}

export interface NamedProjectSyncController {
  getSnapshot(): NamedProjectSyncSnapshot;
  subscribe(listener: () => void): () => void;
  /** Immediately persist the browser draft and drain all currently queued
   * remote work. False means the draft remains dirty/offline/conflicted. */
  flush(): Promise<boolean>;
  /** Retry a failed local flush, upload, or manifest PUT immediately. */
  retry(): Promise<boolean>;
  /** Stop future remote writes after an authoritative 401 or cross-tab
   * sign-out while continuing to preserve the project-scoped browser draft. */
  sessionEnded(): void;
  /** Detach sources and cancel a pending debounce. In-flight work remains
   * bound to this controller's immutable ID and is never retargeted. */
  destroy(): void;
}

const realTransport: NamedProjectSyncTransport = {
  uploadAsset: (projectId, asset) => uploadNamedProjectAsset(projectId, asset),
  updateProject: (projectId, baseRevision, project, assetVerification = []) =>
    updateNamedCloudProject(projectId, baseRevision, project, fetch, assetVerification),
};

function cloneSheets(sheets: SheetsState): SheetsState {
  const clone: SheetsState = Object.create(null) as SheetsState;
  for (const [name, sheet] of Object.entries(sheets)) {
    clone[name] = {
      rows: sheet.rows.map((row) => ({ ...row })),
      editedRows: [...sheet.editedRows],
    };
  }
  return clone;
}

function captureSeed(editor: EditorStore): EditorSeed {
  const state = editor.getState();
  return { code: state.code, sheets: cloneSheets(state.sheets) };
}

function seedFingerprint(seed: EditorSeed): string {
  const sheets: Record<string, unknown> = {};
  for (const name of Object.keys(seed.sheets).sort()) {
    const sheet = seed.sheets[name];
    sheets[name] = {
      rows: sheet.rows.map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))),
      editedRows: sheet.editedRows,
    };
  }
  return JSON.stringify({ code: seed.code, sheets });
}

function manifestMatchesAssets(
  manifest: readonly CloudAssetManifestEntry[],
  assets: AssetStore,
): boolean {
  const metas = assets.getSnapshot().assets;
  if (manifest.length !== metas.length) return false;
  const sorted = [...manifest].sort((a, b) => a.name.localeCompare(b.name));
  return sorted.every((entry, index) => {
    const meta = metas[index];
    return entry.name === meta.name && entry.mime === meta.mime && entry.size === meta.size;
  });
}

function byteLength(asset: StoredAsset): number {
  return asset.bytes instanceof Blob ? asset.bytes.size : asset.bytes.byteLength;
}

function isConflict(error: unknown): boolean {
  return error instanceof ProjectCloudClientError && error.kind === "conflict";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ProjectCloudClientError && error.kind === "unauthorized";
}

export function createNamedProjectSyncController(
  options: NamedProjectSyncOptions,
): NamedProjectSyncController {
  if (!isValidCloudProjectId(options.projectId)) throw new Error("Invalid cloud project ID.");
  if (!Number.isInteger(options.baseRevision) || options.baseRevision < 1) {
    throw new Error("Invalid cloud project revision.");
  }
  const initialRecord = options.projectSession.getSnapshot().record;
  if (
    initialRecord.location !== "cloud" ||
    initialRecord.id !== options.projectId ||
    initialRecord.revision !== options.baseRevision
  ) {
    throw new Error("Project session does not match the bound cloud project.");
  }
  const initialSeed = captureSeed(options.editor);
  if (seedFingerprint(initialSeed) !== seedFingerprint(initialRecord.seed)) {
    throw new Error("Editor content does not match the bound project session.");
  }

  // Captured once. No asynchronous path below consults lifecycle/current ID.
  const projectId = options.projectId;
  const transport = options.transport ?? realTransport;
  const debounceMs = options.debounceMs ?? NAMED_PROJECT_SYNC_DEBOUNCE_MS;
  const now = options.now ?? Date.now;
  let baseRevision = options.baseRevision;
  let snapshot: NamedProjectSyncSnapshot = {
    status: "idle",
    revision: baseRevision,
    dirty: false,
    lastSyncedAt: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draining: Promise<boolean> | null = null;
  let changeVersion = 0;
  let committedVersion = 0;
  let assetGeneration = 0;
  let cachedManifest: CloudAssetManifestEntry[] | null = null;
  let cachedAssetVerification: AssetVerificationSubmission[] = [];
  let cachedManifestGeneration = -1;
  // null means the store changed without per-name detail and requires a full
  // local comparison. Otherwise only these names need byte reads/hashes.
  let dirtyAssetNames: Set<string> | null = new Set();
  let localFlushFailed = false;
  let internalSessionMutation = false;
  let sessionEnded = false;
  let lastEditorFingerprint = seedFingerprint(initialSeed);
  let lastSessionName = initialRecord.name;
  let lastSessionRevision = initialRecord.revision;

  if (
    options.initialAssetManifest !== undefined &&
    manifestMatchesAssets(options.initialAssetManifest, options.assets)
  ) {
    cachedManifest = [...options.initialAssetManifest].sort((a, b) => a.name.localeCompare(b.name));
    cachedAssetVerification = [...(options.initialAssetVerification ?? [])];
    cachedManifestGeneration = assetGeneration;
  } else if (options.assets.getSnapshot().assets.length === 0) {
    cachedManifest = [];
    cachedManifestGeneration = assetGeneration;
  } else {
    // Existing local assets without a trusted opened manifest must upload on
    // the first content/name save.
    assetGeneration = 1;
    dirtyAssetNames = null;
  }

  const publish = (patch: Partial<NamedProjectSyncSnapshot>): void => {
    const next = { ...snapshot, ...patch };
    if (
      next.status === snapshot.status &&
      next.revision === snapshot.revision &&
      next.dirty === snapshot.dirty &&
      next.lastSyncedAt === snapshot.lastSyncedAt &&
      next.error === snapshot.error
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const cancelTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const remoteDirty = (): boolean => committedVersion < changeVersion;

  const schedule = (): void => {
    if (destroyed || timer !== null || draining !== null) return;
    if (
      snapshot.status === "offline" ||
      snapshot.status === "conflict" ||
      snapshot.status === "signed-out"
    ) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, debounceMs);
  };

  const markChanged = (): void => {
    changeVersion += 1;
    publish({ dirty: true });
    // Normal saves are idle-debounced: each new edit restarts the window.
    // During a push, no timer is needed—the drain loop observes the queued
    // version immediately after the current immutable-ID request settles.
    if (
      draining === null &&
      snapshot.status !== "offline" &&
      snapshot.status !== "conflict" &&
      snapshot.status !== "signed-out"
    ) {
      cancelTimer();
    }
    schedule();
  };

  const failLocalDraft = (): void => {
    localFlushFailed = true;
    cancelTimer();
    publish({
      status: "offline",
      dirty: true,
      error: "The browser draft could not be saved. Retry before leaving this project.",
    });
  };

  const flushSessionDraft = (): boolean => {
    try {
      internalSessionMutation = true;
      options.projectSession.flush();
      localFlushFailed = false;
      return true;
    } catch {
      failLocalDraft();
      return false;
    } finally {
      internalSessionMutation = false;
    }
  };

  const syncEditorDraft = (): void => {
    const seed = captureSeed(options.editor);
    const fingerprint = seedFingerprint(seed);
    if (fingerprint === lastEditorFingerprint) return;
    lastEditorFingerprint = fingerprint;
    markChanged();
    try {
      internalSessionMutation = true;
      options.projectSession.replaceSeed(seed);
    } finally {
      internalSessionMutation = false;
    }
    flushSessionDraft();
  };

  const persistRemoteRevision = (revision: number): boolean => {
    try {
      internalSessionMutation = true;
      options.projectSession.setRevision(revision);
      baseRevision = revision;
      lastSessionRevision = revision;
      options.projectSession.flush();
      localFlushFailed = false;
      return true;
    } catch {
      // The remote write already landed. Keep its authoritative revision in
      // memory so Retry cannot submit the prior base and create a false 409.
      baseRevision = revision;
      lastSessionRevision = revision;
      failLocalDraft();
      return false;
    } finally {
      internalSessionMutation = false;
    }
  };

  const uploadManifest = async (generation: number): Promise<{
    assets: CloudAssetManifestEntry[];
    assetVerification: AssetVerificationSubmission[];
  }> => {
    if (cachedManifest !== null && cachedManifestGeneration === generation) {
      return {
        assets: cachedManifest.map((entry) => ({ ...entry })),
        assetVerification: cachedAssetVerification.map((entry) => ({ ...entry })),
      };
    }
    const assetSnapshot = options.assets.getSnapshot();
    if (assetSnapshot.disabled) throw new Error("Project asset storage is unavailable.");
    const manifest: CloudAssetManifestEntry[] = [];
    const assetVerification: AssetVerificationSubmission[] = [];
    const targetDirtyNames = dirtyAssetNames === null ? null : new Set(dirtyAssetNames);
    const priorByName = new Map(cachedManifest?.map((entry) => [entry.name, entry]));
    const priorReceiptByName = new Map(
      cachedAssetVerification.map((entry) => [entry.name, entry.receipt]),
    );
    for (const meta of assetSnapshot.assets) {
      const prior = priorByName.get(meta.name);
      if (
        targetDirtyNames !== null &&
        !targetDirtyNames.has(meta.name) &&
        prior !== undefined &&
        prior.mime === meta.mime &&
        prior.size === meta.size
      ) {
        manifest.push({ ...prior });
        const receipt = priorReceiptByName.get(meta.name);
        if (receipt !== undefined) assetVerification.push({ name: meta.name, receipt });
        continue;
      }
      const asset = await options.assets.getBytes(meta.name);
      if (
        asset === null ||
        asset.name !== meta.name ||
        asset.mime !== meta.mime ||
        byteLength(asset) !== meta.size
      ) {
        throw new Error("Project assets changed while preparing cloud save.");
      }
      // Asset-store notifications do not identify which bytes changed. Hash
      // locally so a one-asset edit in a 100-asset project performs one cloud
      // upload while preserving byte-for-byte correctness for same-size edits.
      const hash = await sha256Hex(await storedAssetBytes(asset));
      if (
        prior !== undefined &&
        prior.mime === meta.mime &&
        prior.size === meta.size &&
        prior.hash === hash
      ) {
        manifest.push({ ...prior });
        const receipt = priorReceiptByName.get(meta.name);
        if (receipt !== undefined) assetVerification.push({ name: meta.name, receipt });
        continue;
      }
      const uploaded = await transport.uploadAsset(projectId, asset);
      if (
        uploaded.name !== meta.name ||
        uploaded.mime !== meta.mime ||
        uploaded.size !== meta.size
      ) {
        throw new Error("Cloud asset upload returned inconsistent metadata.");
      }
      manifest.push({
        name: uploaded.name,
        mime: uploaded.mime,
        size: uploaded.size,
        hash: uploaded.hash,
      });
      if (uploaded.verificationReceipt !== undefined) {
        assetVerification.push({ name: uploaded.name, receipt: uploaded.verificationReceipt });
      }
    }
    manifest.sort((a, b) => a.name.localeCompare(b.name));
    if (assetGeneration === generation) {
      cachedManifest = manifest.map((entry) => ({ ...entry }));
      cachedAssetVerification = assetVerification.map((entry) => ({ ...entry }));
      cachedManifestGeneration = generation;
      dirtyAssetNames = new Set();
    }
    return { assets: manifest, assetVerification };
  };

  const performPush = async (): Promise<boolean> => {
    if (!remoteDirty()) return true;
    if (!flushSessionDraft()) return false;
    const targetVersion = changeVersion;
    const targetAssetGeneration = assetGeneration;
    const targetRevision = baseRevision;
    const seed = captureSeed(options.editor);
    const name = options.projectSession.getSnapshot().record.name;
    publish({ status: "saving", dirty: true, error: null });

    try {
      const prepared = await uploadManifest(targetAssetGeneration);
      if (sessionEnded) return false;
      const project: NamedCloudProjectContent = {
        name,
        ...(options.starterId === undefined ? {} : { starterId: options.starterId }),
        code: seed.code,
        sheets: seed.sheets,
        assets: prepared.assets,
      };
      const result = await transport.updateProject(
        projectId,
        targetRevision,
        project,
        prepared.assetVerification,
      );
      if (!Number.isInteger(result.revision) || result.revision <= targetRevision) {
        throw new Error("Cloud update returned an invalid revision.");
      }
      committedVersion = Math.max(committedVersion, targetVersion);
      const localRevisionSaved = persistRemoteRevision(result.revision);
      if (sessionEnded) {
        publish({
          revision: result.revision,
          status: "signed-out",
          dirty: !localRevisionSaved || remoteDirty(),
          error: "Admin session ended. This browser draft is safe; sign in again from Admin to resume cloud saves.",
        });
        return false;
      }
      publish({
        revision: result.revision,
        lastSyncedAt: now(),
        status: localRevisionSaved ? "saving" : "offline",
        dirty: !localRevisionSaved || remoteDirty(),
        error: localRevisionSaved
          ? null
          : "The cloud save succeeded, but its browser draft could not be updated. Retry before leaving.",
      });
      return localRevisionSaved;
    } catch (error) {
      cancelTimer();
      if (isUnauthorized(error)) sessionEnded = true;
      publish({
        status: isUnauthorized(error)
          ? "signed-out"
          : isConflict(error)
            ? "conflict"
            : "offline",
        dirty: true,
        error: isUnauthorized(error)
          ? "Admin session ended. This browser draft is safe; sign in again from Admin to resume cloud saves."
          : isConflict(error)
            ? "The cloud project changed on another device. Reopen it before saving."
            : "Cloud save failed. Your browser draft is safe. Retry when connected.",
      });
      return false;
    }
  };

  async function drain(): Promise<boolean> {
    if (draining !== null) return draining;
    cancelTimer();
    draining = (async () => {
      if (localFlushFailed && !flushSessionDraft()) return false;
      while (remoteDirty()) {
        if (!(await performPush())) return false;
      }
      if (!localFlushFailed) {
        publish({ status: "idle", dirty: false, error: null });
        return true;
      }
      return false;
    })();
    try {
      return await draining;
    } finally {
      draining = null;
      // A source can publish after the loop condition but before the promise
      // clears. Queue it now instead of waiting for another user edit.
      if (remoteDirty() && snapshot.status === "saving") schedule();
    }
  }

  const unsubscribeEditor = options.editor.subscribe(() => {
    if (!destroyed) syncEditorDraft();
  });
  const unsubscribeSession = options.projectSession.subscribe(() => {
    if (destroyed || internalSessionMutation) return;
    const session = options.projectSession.getSnapshot();
    if (session.record.location !== "cloud" || session.record.id !== projectId) {
      cancelTimer();
      publish({
        status: "conflict",
        dirty: true,
        error: "The active project changed outside its cloud sync session.",
      });
      return;
    }
    if (session.record.revision !== lastSessionRevision) {
      cancelTimer();
      publish({
        status: "conflict",
        dirty: true,
        error: "The project revision changed outside its cloud sync session.",
      });
      return;
    }
    const nameChanged = session.record.name !== lastSessionName;
    lastSessionName = session.record.name;
    if (nameChanged) markChanged();
    if (session.dirty) flushSessionDraft();
  });
  const unsubscribeAssets = options.assets.subscribe((event) => {
    if (destroyed) return;
    assetGeneration += 1;
    // Keep the last verified manifest as a content-addressed baseline. The
    // event identifies the minimum byte subset that needs a fresh local hash.
    cachedManifestGeneration = -1;
    if (dirtyAssetNames !== null) {
      if (event.type === "put") {
        dirtyAssetNames.add(event.name);
      } else if (event.type === "rename") {
        dirtyAssetNames.delete(event.from);
        dirtyAssetNames.add(event.to);
      } else if (event.type === "delete") {
        dirtyAssetNames.delete(event.name);
      } else if (event.type === "clear") {
        dirtyAssetNames.clear();
      } else {
        dirtyAssetNames = null;
      }
    }
    markChanged();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: async () => {
      if (destroyed) return false;
      syncEditorDraft();
      if (!flushSessionDraft()) return false;
      // Once signed out, remote durability is unavailable by definition, but
      // a verified local cache is sufficient to leave this project safely.
      if (sessionEnded) return true;
      return drain();
    },
    retry: async () => {
      if (destroyed) return false;
      if (sessionEnded) return false;
      cancelTimer();
      publish({ status: "idle", error: null, dirty: localFlushFailed || remoteDirty() });
      if (!flushSessionDraft()) return false;
      return drain();
    },
    sessionEnded: () => {
      if (destroyed || sessionEnded) return;
      sessionEnded = true;
      cancelTimer();
      syncEditorDraft();
      flushSessionDraft();
      publish({
        status: "signed-out",
        dirty: remoteDirty() || localFlushFailed,
        error: "Admin session ended. This browser draft is safe; sign in again from Admin to resume cloud saves.",
      });
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelTimer();
      unsubscribeEditor();
      unsubscribeSession();
      unsubscribeAssets();
      listeners.clear();
    },
  };
}
