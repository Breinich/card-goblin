/**
 * Named, multi-project cloud manifest (DESIGN ◆53 / §7.8).
 *
 * This is additive beside projectPayload.ts while the fixed `/cloud/project`
 * controller remains live. New routes use this v2 envelope; the compatibility
 * reader also recognizes the existing revision/code/sheets/assets object under
 * `projects/default/project.json` and synthesizes metadata without rewriting.
 */

import { isRecord, parseSheetsPayload } from "@/app/editor/_store/sheetsPayload";
import type { SheetsState } from "@/app/editor/_store/editorStore";
import {
  ASSET_MAX_BYTES,
  isValidAssetName,
} from "@/app/editor/_store/assetStore";
import {
  isSupportedCloudImageMime,
  MAX_CLOUD_ASSET_NAME_LENGTH,
  parseStoredCloudProjectJson,
  type CloudAssetManifestEntry,
} from "@/lib/cloud/projectPayload";
import {
  LEGACY_CLOUD_PROJECT_ID,
  SHA256_HEX_PATTERN,
  isValidCloudProjectId,
} from "@/lib/cloud/projectIdentity";
import { normalizeProjectName } from "@/lib/projects/projectMetadata";

export const NAMED_CLOUD_PROJECT_FORMAT_VERSION = 2;
export const LEGACY_CLOUD_PROJECT_NAME = "Legacy Cloud Project";
export const LEGACY_CLOUD_PROJECT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type StarterProjectId = "blank" | "poker-deck" | "tcg" | "party-game";

const STARTER_PROJECT_IDS = new Set<StarterProjectId>([
  "blank",
  "poker-deck",
  "tcg",
  "party-game",
]);

export interface NamedCloudProjectContent {
  name: string;
  starterId?: StarterProjectId;
  code: string;
  sheets: SheetsState;
  assets: CloudAssetManifestEntry[];
}

export interface StoredNamedCloudProject extends NamedCloudProjectContent {
  formatVersion: typeof NAMED_CLOUD_PROJECT_FORMAT_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Absent only on a synthesized pre-◆53 legacy record. */
  creationTokenHash?: string;
  creationFingerprint?: string;
}

export interface CloudProjectRecord extends StoredNamedCloudProject {
  legacy: boolean;
}

export interface NamedCloudProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  readable: true;
  legacy: boolean;
}

export interface UnreadableCloudProjectSummary {
  id: string;
  readable: false;
}

/** Public item representation deliberately omits the idempotency hashes. */
export interface PublicNamedCloudProject extends NamedCloudProjectContent {
  formatVersion: typeof NAMED_CLOUD_PROJECT_FORMAT_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  legacy: boolean;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseStarterId(raw: unknown): StarterProjectId | undefined | null {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && STARTER_PROJECT_IDS.has(raw as StarterProjectId)
    ? (raw as StarterProjectId)
    : null;
}

function parseStrictAssets(raw: unknown): CloudAssetManifestEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const assets: CloudAssetManifestEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const { name, mime, size, hash } = item;
    if (
      typeof name !== "string" ||
      !isValidAssetName(name) ||
      name.length > MAX_CLOUD_ASSET_NAME_LENGTH ||
      seen.has(name)
    ) {
      return null;
    }
    if (typeof mime !== "string" || !isSupportedCloudImageMime(mime)) return null;
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size <= 0 ||
      size > ASSET_MAX_BYTES
    ) {
      return null;
    }
    if (typeof hash !== "string" || !SHA256_HEX_PATTERN.test(hash)) return null;
    seen.add(name);
    assets.push({ name, mime, size, hash });
  }
  return assets;
}

export function parseNamedCloudProjectContent(raw: unknown): NamedCloudProjectContent | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.code !== "string") {
    return null;
  }
  const normalizedName = normalizeProjectName(raw.name);
  if (!normalizedName.ok || normalizedName.name !== raw.name) return null;
  if (!isRecord(raw.sheets)) return null;
  const sheets = parseSheetsPayload(raw.sheets);
  if (sheets === null) return null;
  const assets = parseStrictAssets(raw.assets);
  if (assets === null) return null;
  const starterId = parseStarterId(raw.starterId);
  if (starterId === null) return null;
  return {
    name: normalizedName.name,
    ...(starterId === undefined ? {} : { starterId }),
    code: raw.code,
    sheets,
    assets,
  };
}

export function parseStoredNamedCloudProjectJson(
  bytes: Uint8Array,
  expectedId: string,
): CloudProjectRecord | null {
  if (!isValidCloudProjectId(expectedId)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (isRecord(raw) && raw.formatVersion === NAMED_CLOUD_PROJECT_FORMAT_VERSION) {
    if (raw.id !== expectedId) return null;
    if (
      typeof raw.revision !== "number" ||
      !Number.isInteger(raw.revision) ||
      raw.revision < 1 ||
      !isIsoTimestamp(raw.createdAt) ||
      !isIsoTimestamp(raw.updatedAt) ||
      raw.updatedAt < raw.createdAt ||
      typeof raw.creationTokenHash !== "string" ||
      !SHA256_HEX_PATTERN.test(raw.creationTokenHash) ||
      typeof raw.creationFingerprint !== "string" ||
      !SHA256_HEX_PATTERN.test(raw.creationFingerprint)
    ) {
      return null;
    }
    const content = parseNamedCloudProjectContent(raw);
    if (content === null) return null;
    return {
      formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
      id: expectedId,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      revision: raw.revision,
      creationTokenHash: raw.creationTokenHash,
      creationFingerprint: raw.creationFingerprint,
      ...content,
      legacy: false,
    };
  }

  // The only old project ID is `default`; accepting the old envelope beneath
  // any other ID would turn a malformed new object into a misleading project.
  if (expectedId !== LEGACY_CLOUD_PROJECT_ID) return null;
  const legacy = parseStoredCloudProjectJson(bytes);
  if (legacy === null || legacy.revision < 1) return null;
  return {
    formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
    id: LEGACY_CLOUD_PROJECT_ID,
    name: LEGACY_CLOUD_PROJECT_NAME,
    createdAt: LEGACY_CLOUD_PROJECT_TIMESTAMP,
    updatedAt: LEGACY_CLOUD_PROJECT_TIMESTAMP,
    revision: legacy.revision,
    code: legacy.code,
    sheets: legacy.sheets,
    assets: legacy.assets,
    legacy: true,
  };
}

export function serializeStoredNamedCloudProject(project: StoredNamedCloudProject): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...(project.starterId === undefined ? {} : { starterId: project.starterId }),
      revision: project.revision,
      creationTokenHash: project.creationTokenHash,
      creationFingerprint: project.creationFingerprint,
      code: project.code,
      sheets: project.sheets,
      assets: project.assets,
    }),
  );
}

export function namedCloudProjectSummary(project: CloudProjectRecord): NamedCloudProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    revision: project.revision,
    readable: true,
    legacy: project.legacy,
  };
}


export function publicNamedCloudProject(project: CloudProjectRecord): PublicNamedCloudProject {
  return {
    formatVersion: NAMED_CLOUD_PROJECT_FORMAT_VERSION,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...(project.starterId === undefined ? {} : { starterId: project.starterId }),
    revision: project.revision,
    code: project.code,
    sheets: project.sheets,
    assets: project.assets,
    legacy: project.legacy,
  };
}
