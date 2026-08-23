/**
 * Project-scoped browser repository (DESIGN ◆53).
 *
 * Records are written under immutable browser/cloud identities. A record is
 * inactive until the one small active-project pointer names it, which lets the
 * chooser stage and read back content here, verify project-scoped assets in a
 * separate adapter, then perform one synchronous final pointer commit.
 *
 * This module performs no I/O at import time and deliberately does not replace
 * persistence.ts yet. Legacy discovery is read-only; explicit migration never
 * removes or overwrites the legacy source keys.
 */

import type { EditorSeed } from "@/app/editor/_store/editorStore";
import {
  isRecord,
  parseSheetsPayload,
  sheetsToPersisted,
} from "@/app/editor/_store/sheetsPayload";
import { isValidCloudProjectId } from "@/lib/cloud/projectIdentity";
import {
  normalizeProjectName,
  type ProjectNameResult,
} from "@/lib/projects/projectMetadata";

export const PROJECT_RECORD_VERSION = 1;
export const ACTIVE_PROJECT_POINTER_VERSION = 1;
export const PROJECT_RECORD_KEY_PREFIX = "cardgoblin.project-record.v1";
export const ACTIVE_PROJECT_POINTER_KEY = "cardgoblin.active-project.v1";
export const BROWSER_PROJECT_POINTER_KEY = "cardgoblin.browser-project.v1";

/** The original persistence keys are repeated instead of importing
 * persistence.ts, whose module graph initializes the editor singleton. */
export const LEGACY_PROJECT_KEY = "cardgoblin.project.v1";
export const LEGACY_QUARANTINE_KEY = "cardgoblin.project.quarantine";
export const LEGACY_MIGRATION_QUARANTINE_KEY =
  "cardgoblin.project.quarantine.migration";
export const LEGACY_BROWSER_PROJECT_ID = "browser-legacy-v1";
export const LEGACY_BROWSER_PROJECT_NAME = "Browser Project";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BROWSER_PROJECT_ID_PATTERN = new RegExp(`^browser-${UUID_PATTERN.source.slice(1, -1)}$`);

export type ProjectRecordLocation = "browser" | "cloud";

export interface ProjectIdentity {
  location: ProjectRecordLocation;
  id: string;
}

export interface ProjectRecord extends ProjectIdentity {
  name: string;
  /** Browser-only projects have no remote revision. */
  revision: number | null;
  seed: EditorSeed;
}

export type ProjectRecordMetadata = Omit<ProjectRecord, "seed">;

export interface ActiveProjectPointer extends ProjectIdentity {
  version: typeof ACTIVE_PROJECT_POINTER_VERSION;
}

export interface StagedProjectRecord {
  /** The canonical record read back from storage, not the caller's object. */
  readonly record: ProjectRecord;
  /** Opaque verification material used again immediately before commit. */
  readonly storageKey: string;
  readonly serialized: string;
}

export interface ProjectRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isValidBrowserProjectId(id: string): boolean {
  return id === LEGACY_BROWSER_PROJECT_ID || BROWSER_PROJECT_ID_PATTERN.test(id);
}

export function createBrowserProjectId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  const uuid = randomUuid().toLowerCase();
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error("Project ID generator returned an invalid UUID.");
  }
  return `browser-${uuid}`;
}

export function isValidProjectIdentity(identity: ProjectIdentity): boolean {
  return identity.location === "browser"
    ? isValidBrowserProjectId(identity.id)
    : identity.location === "cloud" && isValidCloudProjectId(identity.id);
}

function assertProjectIdentity(identity: ProjectIdentity): void {
  if (!isValidProjectIdentity(identity)) throw new Error("Invalid project identity.");
}

export function projectRecordStorageKey(identity: ProjectIdentity): string {
  assertProjectIdentity(identity);
  return `${PROJECT_RECORD_KEY_PREFIX}.${identity.location}.${identity.id}`;
}

function hasExactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isValidRevision(location: ProjectRecordLocation, revision: unknown): boolean {
  return location === "browser"
    ? revision === null
    : typeof revision === "number" && Number.isInteger(revision) && revision >= 1;
}

/** Strict local record reader. Outer fields are closed/versioned; sheet rows
 * use the same validator and edited-row normalization as every existing
 * project format. Stored names must already be canonical. */
export function parseProjectRecord(raw: string): ProjectRecord | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, [
      "version",
      "location",
      "id",
      "name",
      "revision",
      "code",
      "sheets",
    ]) ||
    payload.version !== PROJECT_RECORD_VERSION ||
    (payload.location !== "browser" && payload.location !== "cloud") ||
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.code !== "string" ||
    !isRecord(payload.sheets)
  ) {
    return null;
  }

  const identity: ProjectIdentity = { location: payload.location, id: payload.id };
  if (!isValidProjectIdentity(identity) || !isValidRevision(identity.location, payload.revision)) {
    return null;
  }
  const name = normalizeProjectName(payload.name);
  if (!name.ok || name.name !== payload.name) return null;
  const sheets = parseSheetsPayload(payload.sheets);
  if (sheets === null) return null;
  return {
    ...identity,
    name: name.name,
    revision: payload.revision as number | null,
    seed: { code: payload.code, sheets },
  };
}

/** Canonical serializer. Runtime validation is intentional: chooser/import
 * inputs are not trusted merely because a TypeScript caller typed them. */
export function serializeProjectRecord(record: ProjectRecord): string {
  assertProjectIdentity(record);
  const name = normalizeProjectName(record.name);
  if (!name.ok || name.name !== record.name) throw new Error("Project name is not canonical.");
  if (!isValidRevision(record.location, record.revision)) {
    throw new Error("Invalid project revision for its location.");
  }
  const raw = JSON.stringify({
    version: PROJECT_RECORD_VERSION,
    location: record.location,
    id: record.id,
    name: record.name,
    revision: record.revision,
    code: record.seed.code,
    sheets: sheetsToPersisted(record.seed.sheets),
  });
  if (parseProjectRecord(raw) === null) throw new Error("Invalid project content.");
  return raw;
}

export function parseActiveProjectPointer(raw: string): ActiveProjectPointer | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ["version", "location", "id"]) ||
    payload.version !== ACTIVE_PROJECT_POINTER_VERSION ||
    (payload.location !== "browser" && payload.location !== "cloud") ||
    typeof payload.id !== "string"
  ) {
    return null;
  }
  const pointer: ActiveProjectPointer = {
    version: ACTIVE_PROJECT_POINTER_VERSION,
    location: payload.location,
    id: payload.id,
  };
  return isValidProjectIdentity(pointer) ? pointer : null;
}

function serializeActiveProjectPointer(record: ProjectRecord): string {
  return JSON.stringify({
    version: ACTIVE_PROJECT_POINTER_VERSION,
    location: record.location,
    id: record.id,
  });
}

export function readProjectRecord(
  storage: ProjectRecordStorage,
  identity: ProjectIdentity,
): ProjectRecord | null {
  const raw = storage.getItem(projectRecordStorageKey(identity));
  if (raw === null) return null;
  const record = parseProjectRecord(raw);
  return record !== null && record.location === identity.location && record.id === identity.id
    ? record
    : null;
}

export function readProjectMetadata(
  storage: ProjectRecordStorage,
  identity: ProjectIdentity,
): ProjectRecordMetadata | null {
  const record = readProjectRecord(storage, identity);
  if (record === null) return null;
  return {
    location: record.location,
    id: record.id,
    name: record.name,
    revision: record.revision,
  };
}

export function readActiveProjectPointer(
  storage: ProjectRecordStorage,
): ActiveProjectPointer | null {
  const raw = storage.getItem(ACTIVE_PROJECT_POINTER_KEY);
  return raw === null ? null : parseActiveProjectPointer(raw);
}

export function readActiveProjectRecord(storage: ProjectRecordStorage): ProjectRecord | null {
  const pointer = readActiveProjectPointer(storage);
  return pointer === null ? null : readProjectRecord(storage, pointer);
}

/** The last browser-only project remains recoverable even while the global
 * active pointer names a cloud cache. Older installs have only the active
 * pointer, so a browser-valued active pointer is the read-only fallback. */
export function readBrowserProjectRecord(storage: ProjectRecordStorage): ProjectRecord | null {
  const raw = storage.getItem(BROWSER_PROJECT_POINTER_KEY);
  if (raw !== null) {
    const pointer = parseActiveProjectPointer(raw);
    if (pointer?.location === "browser") {
      const record = readProjectRecord(storage, pointer);
      if (record !== null) return record;
    }
  }
  const active = readActiveProjectRecord(storage);
  return active?.location === "browser" ? active : null;
}

function writeAndVerifyProjectRecord(
  storage: ProjectRecordStorage,
  record: ProjectRecord,
): StagedProjectRecord {
  const storageKey = projectRecordStorageKey(record);
  const serialized = serializeProjectRecord(record);
  storage.setItem(storageKey, serialized);
  const readBack = storage.getItem(storageKey);
  if (readBack !== serialized) throw new Error("Project record could not be verified after writing.");
  const parsed = parseProjectRecord(readBack);
  if (parsed === null) throw new Error("Project record could not be verified after writing.");
  return { record: parsed, storageKey, serialized };
}

/** Stage a newly opened/created project without changing which project is
 * active. Reusing the current active identity is rejected; updates use the
 * explicit update/session APIs instead. */
export function stageProjectRecord(
  storage: ProjectRecordStorage,
  record: ProjectRecord,
): StagedProjectRecord {
  const current = readActiveProjectPointer(storage);
  if (current?.location === record.location && current.id === record.id) {
    throw new Error("The active project cannot be staged as an inactive project.");
  }
  const storageKey = projectRecordStorageKey(record);
  const serialized = serializeProjectRecord(record);
  const existingRaw = storage.getItem(storageKey);
  if (existingRaw !== null) {
    const existing = parseProjectRecord(existingRaw);
    if (
      existingRaw === serialized &&
      existing !== null &&
      existing.location === record.location &&
      existing.id === record.id
    ) {
      return { record: existing, storageKey, serialized };
    }
    throw new Error("A different project record already exists for this immutable ID.");
  }
  return writeAndVerifyProjectRecord(storage, record);
}

/** Verify the exact staged bytes again, then atomically replace the small
 * active pointer. Call this only after the asset staging slice verifies its
 * project-scoped namespace. A thrown setItem leaves Web Storage's old pointer
 * authoritative, while the staged record remains unreachable and recoverable. */
export function commitStagedProjectRecord(
  storage: ProjectRecordStorage,
  staged: StagedProjectRecord,
): ProjectRecord {
  const expectedKey = projectRecordStorageKey(staged.record);
  if (staged.storageKey !== expectedKey || serializeProjectRecord(staged.record) !== staged.serialized) {
    throw new Error("Invalid staged project record.");
  }
  const readBack = storage.getItem(expectedKey);
  if (readBack !== staged.serialized || parseProjectRecord(readBack) === null) {
    throw new Error("Staged project changed before commit.");
  }
  if (staged.record.location === "browser") {
    const browserPointer = serializeActiveProjectPointer(staged.record);
    storage.setItem(BROWSER_PROJECT_POINTER_KEY, browserPointer);
    if (storage.getItem(BROWSER_PROJECT_POINTER_KEY) !== browserPointer) {
      throw new Error("Browser project pointer could not be verified after writing.");
    }
  }
  storage.setItem(ACTIVE_PROJECT_POINTER_KEY, serializeActiveProjectPointer(staged.record));
  return staged.record;
}

/** Update an existing record in place and read it back. Its immutable identity
 * cannot be changed through this API, and no other record is removed. */
export function updateProjectRecord(
  storage: ProjectRecordStorage,
  record: ProjectRecord,
): ProjectRecord {
  const existing = readProjectRecord(storage, record);
  if (existing === null) throw new Error("Project record does not exist.");
  return writeAndVerifyProjectRecord(storage, record).record;
}

export interface ProjectMetadataPatch {
  name?: string;
  revision?: number | null;
}

export interface ProjectRecordUpdateResult {
  record: ProjectRecord;
  changed: boolean;
}

/** Normalize and persist mutable metadata while identity remains immutable. */
export function updateProjectMetadata(
  storage: ProjectRecordStorage,
  identity: ProjectIdentity,
  patch: ProjectMetadataPatch,
): ProjectRecordUpdateResult {
  const current = readProjectRecord(storage, identity);
  if (current === null) throw new Error("Project record does not exist.");
  let name = current.name;
  if (patch.name !== undefined) {
    const result = normalizeProjectName(patch.name);
    if (!result.ok) throw new Error(result.error ?? "Invalid project name.");
    name = result.name;
  }
  const revision = patch.revision === undefined ? current.revision : patch.revision;
  if (name === current.name && revision === current.revision) {
    return { record: current, changed: false };
  }
  const record = updateProjectRecord(storage, { ...current, name, revision });
  return { record, changed: true };
}

export function renameProjectRecord(
  storage: ProjectRecordStorage,
  identity: ProjectIdentity,
  name: string,
): ProjectRecordUpdateResult {
  return updateProjectMetadata(storage, identity, { name });
}

export type LegacyProjectDiscovery =
  | { status: "missing" }
  | { status: "valid"; raw: string; seed: EditorSeed }
  | { status: "corrupt"; raw: string };

function parseLegacySeed(raw: string): EditorSeed | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(payload) ||
    payload.version !== 1 ||
    typeof payload.code !== "string" ||
    !isRecord(payload.sheets)
  ) {
    return null;
  }
  const sheets = parseSheetsPayload(payload.sheets);
  return sheets === null ? null : { code: payload.code, sheets };
}

/** Startup-safe legacy inspection. It never writes quarantine or migration
 * state; an inaccessible storage object throws rather than mislabeling data. */
export function discoverLegacyProject(storage: ProjectRecordStorage): LegacyProjectDiscovery {
  const raw = storage.getItem(LEGACY_PROJECT_KEY);
  if (raw === null) return { status: "missing" };
  const seed = parseLegacySeed(raw);
  return seed === null ? { status: "corrupt", raw } : { status: "valid", raw, seed };
}

function quarantineCorruptLegacyProject(storage: ProjectRecordStorage, raw: string): void {
  const existingPrimary = storage.getItem(LEGACY_QUARANTINE_KEY);
  const key = existingPrimary === null || existingPrimary === raw
    ? LEGACY_QUARANTINE_KEY
    : LEGACY_MIGRATION_QUARANTINE_KEY;
  const existing = storage.getItem(key);
  if (existing === raw) return;
  if (existing !== null) {
    // Both quarantine slots already preserve different evidence. The corrupt
    // source remains under LEGACY_PROJECT_KEY, so never overwrite either.
    return;
  }
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Legacy quarantine could not be verified.");
}

/** Explicit recovery migration. The caller supplies the read-only discovery
 * snapshot it showed in the chooser; a source change requires rediscovery.
 * The deterministic record is staged but not activated, leaving the asset
 * migration slice time to verify bytes before commitStagedProjectRecord.
 * Calling this function is the user's recovery choice, so corrupt content is
 * quarantined here—not during discovery—and recovers as an empty seed. */
export function stageLegacyBrowserProjectMigration(
  storage: ProjectRecordStorage,
  discovery: LegacyProjectDiscovery,
): StagedProjectRecord {
  const currentRaw = storage.getItem(LEGACY_PROJECT_KEY);
  const discoveredRaw = discovery.status === "missing" ? null : discovery.raw;
  if (currentRaw !== discoveredRaw) throw new Error("Legacy project changed; discover it again.");

  if (discovery.status === "corrupt") quarantineCorruptLegacyProject(storage, discovery.raw);

  const identity: ProjectIdentity = { location: "browser", id: LEGACY_BROWSER_PROJECT_ID };
  const existing = readProjectRecord(storage, identity);
  if (existing !== null) {
    return {
      record: existing,
      storageKey: projectRecordStorageKey(existing),
      serialized: serializeProjectRecord(existing),
    };
  }

  const reparsedSeed = discovery.status === "valid" ? parseLegacySeed(discovery.raw) : null;
  if (discovery.status === "valid" && reparsedSeed === null) {
    throw new Error("Legacy project changed; discover it again.");
  }
  const seed = reparsedSeed ?? { code: "", sheets: {} };
  return stageProjectRecord(storage, {
    ...identity,
    name: LEGACY_BROWSER_PROJECT_NAME,
    revision: null,
    seed,
  });
}

export interface ProjectRecordSessionSnapshot {
  record: ProjectRecord;
  contentDirty: boolean;
  metadataDirty: boolean;
  dirty: boolean;
}

export interface ProjectRecordSession {
  getSnapshot(): ProjectRecordSessionSnapshot;
  subscribe(listener: () => void): () => void;
  rename(name: string): ProjectNameResult;
  replaceSeed(seed: EditorSeed): void;
  setRevision(revision: number | null): void;
  /** Persist all dirty channels together. A failure leaves dirty flags set. */
  flush(): ProjectRecord;
}

function sameSeed(a: EditorSeed, b: EditorSeed): boolean {
  return (
    a.code === b.code &&
    JSON.stringify(sheetsToPersisted(a.sheets)) === JSON.stringify(sheetsToPersisted(b.sheets))
  );
}

/** Subscribable draft for one immutable active identity. Metadata has its own
 * dirty bit so a rename with unchanged code/sheets cannot be skipped by the
 * content autosave's reference checks. */
export function createProjectRecordSession(
  storage: ProjectRecordStorage,
  initial: ProjectRecord,
): ProjectRecordSession {
  const canonical = parseProjectRecord(serializeProjectRecord(initial));
  if (canonical === null) throw new Error("Invalid initial project record.");
  let snapshot: ProjectRecordSessionSnapshot = {
    record: canonical,
    contentDirty: false,
    metadataDirty: false,
    dirty: false,
  };
  const listeners = new Set<() => void>();

  const publish = (
    record: ProjectRecord,
    contentDirty: boolean,
    metadataDirty: boolean,
  ): void => {
    snapshot = {
      record,
      contentDirty,
      metadataDirty,
      dirty: contentDirty || metadataDirty,
    };
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rename: (input) => {
      const result = normalizeProjectName(input);
      if (!result.ok || result.name === snapshot.record.name) return result;
      publish(
        { ...snapshot.record, name: result.name },
        snapshot.contentDirty,
        true,
      );
      return result;
    },
    replaceSeed: (seed) => {
      if (sameSeed(seed, snapshot.record.seed)) return;
      publish(
        { ...snapshot.record, seed },
        true,
        snapshot.metadataDirty,
      );
    },
    setRevision: (revision) => {
      if (!isValidRevision(snapshot.record.location, revision)) {
        throw new Error("Invalid project revision for its location.");
      }
      if (revision === snapshot.record.revision) return;
      publish(
        { ...snapshot.record, revision },
        snapshot.contentDirty,
        true,
      );
    },
    flush: () => {
      if (!snapshot.dirty) return snapshot.record;
      const saved = updateProjectRecord(storage, snapshot.record);
      publish(saved, false, false);
      return saved;
    },
  };
}
