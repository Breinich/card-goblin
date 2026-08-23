import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_PROJECT_POINTER_KEY,
  LEGACY_BROWSER_PROJECT_ID,
  LEGACY_MIGRATION_QUARANTINE_KEY,
  LEGACY_PROJECT_KEY,
  LEGACY_QUARANTINE_KEY,
  PROJECT_RECORD_KEY_PREFIX,
  commitStagedProjectRecord,
  createBrowserProjectId,
  createProjectRecordSession,
  discoverLegacyProject,
  isValidBrowserProjectId,
  isValidProjectIdentity,
  parseProjectRecord,
  projectRecordStorageKey,
  readActiveProjectRecord,
  readBrowserProjectRecord,
  readProjectMetadata,
  readProjectRecord,
  renameProjectRecord,
  serializeProjectRecord,
  stageLegacyBrowserProjectMigration,
  stageProjectRecord,
  updateProjectMetadata,
  type ProjectIdentity,
  type ProjectRecord,
  type ProjectRecordStorage,
} from "@/app/editor/_store/projectRepository";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const CLOUD_UUID = "223e4567-e89b-42d3-a456-426614174001";

class MemoryStorage implements ProjectRecordStorage {
  readonly map = new Map<string, string>();
  readonly writes: { key: string; value: string }[] = [];
  throwGetKey: string | null = null;
  throwSetKey: string | null = null;
  corruptReadBackKey: string | null = null;

  getItem(key: string): string | null {
    if (this.throwGetKey === key) throw new Error(`get failed: ${key}`);
    const value = this.map.get(key) ?? null;
    return key === this.corruptReadBackKey && value !== null ? `${value}corrupt` : value;
  }

  setItem(key: string, value: string): void {
    if (this.throwSetKey === key) throw new Error(`set failed: ${key}`);
    this.map.set(key, value);
    this.writes.push({ key, value });
  }
}

const browserIdentity: ProjectIdentity = {
  location: "browser",
  id: `browser-${UUID}`,
};

const cloudIdentity: ProjectIdentity = { location: "cloud", id: CLOUD_UUID };

function record(
  identity: ProjectIdentity = browserIdentity,
  name = "Café Cards 🃏",
): ProjectRecord {
  return {
    ...identity,
    name,
    revision: identity.location === "browser" ? null : 3,
    seed: {
      code: "Sheet: Cards\n  column title: Text\n",
      sheets: {
        Cards: {
          rows: [
            { title: "One", __orphan__retired: "保留" },
            { title: "" },
          ],
          editedRows: [true, false],
        },
      },
    },
  };
}

function activate(storage: MemoryStorage, project: ProjectRecord): ProjectRecord {
  return commitStagedProjectRecord(storage, stageProjectRecord(storage, project));
}

describe("project identity", () => {
  it("uses a closed browser UUID namespace plus one deterministic legacy ID", () => {
    expect(createBrowserProjectId(() => UUID.toUpperCase())).toBe(`browser-${UUID}`);
    expect(isValidBrowserProjectId(`browser-${UUID}`)).toBe(true);
    expect(isValidBrowserProjectId(LEGACY_BROWSER_PROJECT_ID)).toBe(true);
    for (const invalid of [UUID, "browser-default", "browser-../escape", "browser-", "Browser-" + UUID]) {
      expect(isValidBrowserProjectId(invalid)).toBe(false);
    }
    expect(() => createBrowserProjectId(() => "../bad")).toThrow(/invalid UUID/);
  });

  it("validates browser and cloud identities without allowing them to alias", () => {
    expect(isValidProjectIdentity(browserIdentity)).toBe(true);
    expect(isValidProjectIdentity(cloudIdentity)).toBe(true);
    expect(isValidProjectIdentity({ location: "cloud", id: "default" })).toBe(true);
    expect(isValidProjectIdentity({ location: "browser", id: CLOUD_UUID })).toBe(false);
    expect(isValidProjectIdentity({ location: "cloud", id: `browser-${UUID}` })).toBe(false);
    expect(projectRecordStorageKey(browserIdentity)).toContain(".browser.browser-");
    expect(projectRecordStorageKey(cloudIdentity)).toContain(".cloud.");
  });
});

describe("strict project records", () => {
  it("round-trips Unicode, orphaned cells, empty cells, and edited-row state", () => {
    const original = record();
    const raw = serializeProjectRecord(original);
    const parsed = parseProjectRecord(raw);
    expect(parsed).toEqual(original);
    expect(parsed?.seed.sheets.Cards.rows[0].__orphan__retired).toBe("保留");
    expect(parsed?.seed.sheets.Cards.editedRows).toEqual([true, false]);
  });

  it("normalizes legacy edited flags through the shared sheet parser", () => {
    const raw = JSON.parse(serializeProjectRecord(record())) as Record<string, unknown>;
    const sheets = raw.sheets as { Cards: { editedRows: unknown[] } };
    sheets.Cards.editedRows = [1, true];
    expect(parseProjectRecord(JSON.stringify(raw))?.seed.sheets.Cards.editedRows).toEqual([
      false,
      true,
    ]);
  });

  it("rejects noncanonical names, invalid identity/revision/content, and unknown outer fields", () => {
    const base = JSON.parse(serializeProjectRecord(record())) as Record<string, unknown>;
    const invalid: Record<string, unknown>[] = [
      { ...base, name: " Cafe\u0301 Cards 🃏 " },
      { ...base, id: "../escape" },
      { ...base, revision: 0 },
      { ...base, code: 4 },
      { ...base, future: true },
      { ...base, sheets: { Cards: { rows: [{ title: 4 }], editedRows: [] } } },
    ];
    for (const payload of invalid) expect(parseProjectRecord(JSON.stringify(payload))).toBeNull();

    expect(() => serializeProjectRecord({ ...record(), name: " Cafe\u0301 Cards 🃏 " })).toThrow(
      /canonical/,
    );
  });

  it("requires null revisions for browser records and positive integer revisions for cloud caches", () => {
    expect(parseProjectRecord(serializeProjectRecord(record(cloudIdentity)))?.revision).toBe(3);
    expect(() => serializeProjectRecord({ ...record(), revision: 1 })).toThrow(/revision/);
    expect(() => serializeProjectRecord({ ...record(cloudIdentity), revision: null })).toThrow(
      /revision/,
    );
  });
});

describe("inactive staging and active-pointer commit", () => {
  it("reads back an inactive record and changes only the pointer at final commit", () => {
    const storage = new MemoryStorage();
    const old = activate(storage, record(browserIdentity, "Old project"));
    const next = record({ location: "browser", id: createBrowserProjectId(() => CLOUD_UUID) }, "Next");

    const staged = stageProjectRecord(storage, next);
    expect(staged.record).toEqual(next);
    expect(readProjectRecord(storage, next)).toEqual(next);
    expect(readActiveProjectRecord(storage)).toEqual(old);
    // This gap is where the separate asset slice stages and verifies bytes.
    expect(commitStagedProjectRecord(storage, staged)).toEqual(next);
    expect(readActiveProjectRecord(storage)).toEqual(next);
    expect(readProjectRecord(storage, old)).toEqual(old); // never deleted
  });

  it("keeps the last browser project discoverable while a cloud cache is active", () => {
    const storage = new MemoryStorage();
    const browser = activate(storage, record(browserIdentity, "Local Deck"));
    const cloud = activate(storage, record(cloudIdentity, "Cloud Deck"));

    expect(readActiveProjectRecord(storage)).toEqual(cloud);
    expect(readBrowserProjectRecord(storage)).toEqual(browser);
  });

  it("makes staging Retry idempotent but refuses a same-ID payload collision", () => {
    const storage = new MemoryStorage();
    const next = record();
    const first = stageProjectRecord(storage, next);
    const writes = storage.writes.length;
    const retry = stageProjectRecord(storage, next);
    expect(retry).toEqual(first);
    expect(storage.writes).toHaveLength(writes);
    expect(() => stageProjectRecord(storage, { ...next, name: "Collision" })).toThrow(
      /different project record/,
    );
    expect(readProjectRecord(storage, next)).toEqual(next);
  });

  it("rejects staging over the active identity", () => {
    const storage = new MemoryStorage();
    const active = activate(storage, record());
    expect(() => stageProjectRecord(storage, { ...active, name: "Overwrite" })).toThrow(
      /active project/,
    );
  });

  it("refuses a changed staged record while the old pointer remains authoritative", () => {
    const storage = new MemoryStorage();
    const old = activate(storage, record(browserIdentity, "Old"));
    const next = record({ location: "browser", id: createBrowserProjectId(() => CLOUD_UUID) }, "Next");
    const staged = stageProjectRecord(storage, next);
    storage.map.set(staged.storageKey, serializeProjectRecord({ ...next, name: "Tampered" }));

    expect(() => commitStagedProjectRecord(storage, staged)).toThrow(/changed before commit/);
    expect(readActiveProjectRecord(storage)).toEqual(old);
  });

  it("leaves the old pointer authoritative when the pointer write throws", () => {
    const storage = new MemoryStorage();
    const old = activate(storage, record(browserIdentity, "Old"));
    const next = record({ location: "browser", id: createBrowserProjectId(() => CLOUD_UUID) }, "Next");
    const staged = stageProjectRecord(storage, next);
    const pointerBefore = storage.map.get(ACTIVE_PROJECT_POINTER_KEY);
    storage.throwSetKey = ACTIVE_PROJECT_POINTER_KEY;

    expect(() => commitStagedProjectRecord(storage, staged)).toThrow(/set failed/);
    expect(storage.map.get(ACTIVE_PROJECT_POINTER_KEY)).toBe(pointerBefore);
    expect(readActiveProjectRecord(storage)).toEqual(old);
    expect(readProjectRecord(storage, next)).toEqual(next); // unreachable staging survives
  });

  it("does not commit a stage that failed write-back verification", () => {
    const storage = new MemoryStorage();
    activate(storage, record());
    const next = record({ location: "browser", id: createBrowserProjectId(() => CLOUD_UUID) }, "Next");
    storage.corruptReadBackKey = projectRecordStorageKey(next);
    expect(() => stageProjectRecord(storage, next)).toThrow(/verified/);
    expect(readActiveProjectRecord(storage)?.name).toBe("Café Cards 🃏");
  });
});

describe("metadata APIs and rename-only dirty tracking", () => {
  it("reads, normalizes, renames, and updates metadata without touching identity or content", () => {
    const storage = new MemoryStorage();
    const original = activate(storage, record());
    const renamed = renameProjectRecord(storage, original, "  Cafe\u0301 Renamed 🃏  ");
    expect(renamed).toMatchObject({ changed: true, record: { name: "Café Renamed 🃏" } });
    expect(renamed.record.id).toBe(original.id);
    expect(renamed.record.seed).toEqual(original.seed);
    expect(readProjectMetadata(storage, original)).toEqual({
      location: original.location,
      id: original.id,
      name: "Café Renamed 🃏",
      revision: null,
    });

    const unchanged = updateProjectMetadata(storage, original, { name: "Café Renamed 🃏" });
    expect(unchanged.changed).toBe(false);
  });

  it("marks a rename dirty even with unchanged code/sheets, then flushes it", () => {
    const storage = new MemoryStorage();
    const original = activate(storage, record());
    const session = createProjectRecordSession(storage, original);
    const listener = vi.fn();
    session.subscribe(listener);

    expect(session.rename("  Renamed only  ")).toMatchObject({ ok: true, name: "Renamed only" });
    expect(session.getSnapshot()).toMatchObject({
      contentDirty: false,
      metadataDirty: true,
      dirty: true,
    });
    expect(session.getSnapshot().record.seed).toEqual(original.seed);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(session.flush().name).toBe("Renamed only");
    expect(session.getSnapshot()).toMatchObject({
      contentDirty: false,
      metadataDirty: false,
      dirty: false,
    });
    expect(readActiveProjectRecord(storage)?.name).toBe("Renamed only");
  });

  it("keeps rename-only state dirty when storage rejects the flush", () => {
    const storage = new MemoryStorage();
    const original = activate(storage, record());
    const session = createProjectRecordSession(storage, original);
    session.rename("Unsaved rename");
    storage.throwSetKey = projectRecordStorageKey(original);
    expect(() => session.flush()).toThrow(/set failed/);
    expect(session.getSnapshot()).toMatchObject({ metadataDirty: true, dirty: true });
    expect(readActiveProjectRecord(storage)?.name).toBe(original.name);
  });

  it("tracks content and metadata independently and flushes one coherent record", () => {
    const storage = new MemoryStorage();
    const original = activate(storage, record());
    const session = createProjectRecordSession(storage, original);
    session.replaceSeed({ ...original.seed, code: `${original.seed.code}\n# edited` });
    expect(session.getSnapshot()).toMatchObject({ contentDirty: true, metadataDirty: false });
    session.rename("Both changed");
    expect(session.getSnapshot()).toMatchObject({ contentDirty: true, metadataDirty: true });
    const flushed = session.flush();
    expect(flushed).toMatchObject({ name: "Both changed", seed: { code: expect.stringContaining("edited") } });
  });
});

describe("read-only legacy discovery and explicit migration", () => {
  const legacyRaw = JSON.stringify({
    version: 1,
    code: "legacy code",
    sheets: {
      Old: {
        rows: [{ alive: "yes", __orphan__removed: "still here" }],
        editedRows: [true],
      },
    },
  });

  it("distinguishes missing, valid, and corrupt content without writing", () => {
    const missing = new MemoryStorage();
    expect(discoverLegacyProject(missing)).toEqual({ status: "missing" });
    expect(missing.writes).toEqual([]);

    const valid = new MemoryStorage();
    valid.map.set(LEGACY_PROJECT_KEY, legacyRaw);
    expect(discoverLegacyProject(valid)).toMatchObject({
      status: "valid",
      seed: { code: "legacy code" },
    });
    expect(valid.writes).toEqual([]);

    const corrupt = new MemoryStorage();
    corrupt.map.set(LEGACY_PROJECT_KEY, "{broken");
    expect(discoverLegacyProject(corrupt)).toEqual({ status: "corrupt", raw: "{broken" });
    expect(corrupt.map.has(LEGACY_QUARANTINE_KEY)).toBe(false);
    expect(corrupt.writes).toEqual([]);
  });

  it("stages deterministic valid migration, preserves legacy keys, and is idempotent", () => {
    const storage = new MemoryStorage();
    storage.map.set(LEGACY_PROJECT_KEY, legacyRaw);
    const discovery = discoverLegacyProject(storage);
    const first = stageLegacyBrowserProjectMigration(storage, discovery);
    expect(first.record).toMatchObject({
      location: "browser",
      id: LEGACY_BROWSER_PROJECT_ID,
      name: "Browser Project",
      seed: { code: "legacy code" },
    });
    expect(first.record.seed.sheets.Old.rows[0].__orphan__removed).toBe("still here");
    expect(storage.map.get(LEGACY_PROJECT_KEY)).toBe(legacyRaw);
    expect(readActiveProjectRecord(storage)).toBeNull();

    commitStagedProjectRecord(storage, first);
    const writeCount = storage.writes.length;
    const second = stageLegacyBrowserProjectMigration(storage, discovery);
    expect(second.record).toEqual(first.record);
    expect(storage.writes).toHaveLength(writeCount); // valid target reused, not overwritten
    commitStagedProjectRecord(storage, second);
    expect(readActiveProjectRecord(storage)).toEqual(first.record);
    expect(storage.map.get(LEGACY_PROJECT_KEY)).toBe(legacyRaw);
  });

  it("quarantines corrupt raw only when recovery is chosen and stages an empty seed", () => {
    const storage = new MemoryStorage();
    storage.map.set(LEGACY_PROJECT_KEY, "{broken");
    const discovery = discoverLegacyProject(storage);
    expect(storage.map.has(LEGACY_QUARANTINE_KEY)).toBe(false);

    const staged = stageLegacyBrowserProjectMigration(storage, discovery);
    expect(storage.map.get(LEGACY_QUARANTINE_KEY)).toBe("{broken");
    expect(staged.record.seed).toEqual({ code: "", sheets: {} });
    expect(storage.map.get(LEGACY_PROJECT_KEY)).toBe("{broken");
  });

  it("preserves prior quarantine evidence in a second verified slot", () => {
    const storage = new MemoryStorage();
    storage.map.set(LEGACY_PROJECT_KEY, "new broken raw");
    storage.map.set(LEGACY_QUARANTINE_KEY, "older broken raw");
    stageLegacyBrowserProjectMigration(storage, discoverLegacyProject(storage));
    expect(storage.map.get(LEGACY_QUARANTINE_KEY)).toBe("older broken raw");
    expect(storage.map.get(LEGACY_MIGRATION_QUARANTINE_KEY)).toBe("new broken raw");
  });

  it("requires rediscovery if another tab changes the legacy source", () => {
    const storage = new MemoryStorage();
    storage.map.set(LEGACY_PROJECT_KEY, legacyRaw);
    const stale = discoverLegacyProject(storage);
    storage.map.set(LEGACY_PROJECT_KEY, `${legacyRaw} `);
    expect(() => stageLegacyBrowserProjectMigration(storage, stale)).toThrow(/discover it again/);
    expect(storage.map.has(`${PROJECT_RECORD_KEY_PREFIX}.browser.${LEGACY_BROWSER_PROJECT_ID}`)).toBe(
      false,
    );
  });

  it("surfaces inaccessible storage instead of calling it missing or corrupt", () => {
    const storage = new MemoryStorage();
    storage.throwGetKey = LEGACY_PROJECT_KEY;
    expect(() => discoverLegacyProject(storage)).toThrow(/get failed/);
  });
});
