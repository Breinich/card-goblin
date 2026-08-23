/**
 * Portable CardGoblin project-file codec.
 *
 * This module is deliberately free of React, browser storage, and editor
 * singletons so the startup chooser and build-time starter validation can use
 * the exact same reader as the connected editor UI. Project files contain
 * project content only: storage IDs, cloud revisions, timestamps, and other
 * lifecycle metadata never belong here.
 *
 * Compatibility is intentionally asymmetric with new asset ingestion. The v2
 * reader freezes the legacy application's acceptance boundary (any `image/*`
 * MIME, zero-byte assets, and identifier-style names with no length cap) so a
 * future stricter upload policy cannot strand an existing backup.
 */

import type { RenderModel } from "@/lib/lang";
import type {
  EditorSeed,
  SheetsState,
} from "@/app/editor/_store/editorStore";
import type { StoredAsset } from "@/app/editor/_store/assetStore";
import {
  isRecord,
  parseSheetsPayload,
  sheetsToPersisted,
} from "@/app/editor/_store/sheetsPayload";
import { normalizeProjectName } from "@/lib/projects/projectMetadata";

/** The current portable project-file version. Optional metadata such as
 * `name` remains a backward-compatible extension of version 2. */
export const PROJECT_FILE_VERSION = 2;

/** Version 1 is the historical code-and-sheets-only shape. Keep this local to
 * the portable codec so importing it never initializes the persistence or
 * editor singletons. */
const LEGACY_PROJECT_FILE_VERSION = 1;

/** The old reader's actual acceptance boundary. These constants must not be
 * replaced by the new-upload allowlist: existing backups depend on them. */
const LEGACY_ASSET_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const LEGACY_ASSET_MAX_BYTES = 2 * 1024 * 1024;

/** One asset entry inside a v2 file's `assets` object. */
interface PersistedAssetV2 {
  mime: string;
  bytes: string;
}

/** A parsed project file, ready to stage. `assets` is empty for a v1 file. */
export interface ParsedProjectFile {
  seed: EditorSeed;
  assets: StoredAsset[];
  /** Valid portable display metadata. Missing or invalid names are ignored so
   * otherwise-valid legacy/hand-authored content remains recoverable. */
  name?: string;
}

/** §7.1's one import error. Validation is all-or-nothing for project content
 * and assets; optional metadata never causes content rejection. */
export const IMPORT_INVALID_MESSAGE =
  "Not a readable CardGoblin project file — nothing was imported.";

/** Normalize and validate the portable project display name. Names are NFC,
 * trimmed, 1–80 Unicode code points, and contain no Unicode control
 * characters. Invalid or non-string values are absent rather than fatal. */
export function parsePortableProjectName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = normalizeProjectName(value);
  return result.ok ? result.name : undefined;
}

/** `cardgoblin-project.cardgoblin.json`, except a model with exactly one Card
 * block uses `<deckname>.cardgoblin.json`. A portable display name does not
 * alter this established download-filename rule. */
export function projectFileName(model: RenderModel | null): string {
  const fallback = "cardgoblin-project.cardgoblin.json";
  if (model === null || model.decks.length !== 1) return fallback;
  const cleaned = model.decks[0].cardName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? `${cleaned}.cardgoblin.json` : fallback;
}

/** Byte-exact base64 encode, chunked to avoid the argument-count ceiling on
 * large assets. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The old reader used `atob` directly. Preserve exactly that acceptance
 * behavior instead of introducing a subtly different base64 validator. */
function base64ToBytes(base64: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function assetBytes(asset: StoredAsset): Promise<Uint8Array> {
  return asset.bytes instanceof Blob
    ? new Uint8Array(await asset.bytes.arrayBuffer())
    : asset.bytes;
}

/** Build the current v2 portable payload. Omitting `name` emits the exact
 * historical field set and ordering; a valid name is appended as an optional
 * top-level field that old readers ignore. */
export async function buildProjectExport(
  code: string,
  sheets: SheetsState,
  model: RenderModel | null,
  assets: readonly StoredAsset[] = [],
  name?: string,
): Promise<{ filename: string; json: string }> {
  const persistedAssets: Record<string, PersistedAssetV2> = {};
  for (const asset of assets) {
    persistedAssets[asset.name] = {
      mime: asset.mime,
      bytes: bytesToBase64(await assetBytes(asset)),
    };
  }

  const portableName = parsePortableProjectName(name);
  const payload = {
    version: PROJECT_FILE_VERSION,
    code,
    sheets: sheetsToPersisted(sheets),
    assets: persistedAssets,
    ...(portableName === undefined ? {} : { name: portableName }),
  };
  return { filename: projectFileName(model), json: JSON.stringify(payload) };
}

function parseAssetsPayload(raw: Record<string, unknown>): StoredAsset[] | null {
  const assets: StoredAsset[] = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (!LEGACY_ASSET_NAME_PATTERN.test(name)) return null;
    if (!isRecord(entry) || typeof entry.mime !== "string" || typeof entry.bytes !== "string") {
      return null;
    }
    if (!entry.mime.startsWith("image/")) return null;
    const bytes = base64ToBytes(entry.bytes);
    if (bytes === null || bytes.byteLength > LEGACY_ASSET_MAX_BYTES) return null;
    assets.push({ name, mime: entry.mime, bytes });
  }
  return assets;
}

function parsedName(payload: Record<string, unknown>): Pick<ParsedProjectFile, "name"> {
  const name = parsePortableProjectName(payload.name);
  return name === undefined ? {} : { name };
}

function parseProjectFileV1(payload: Record<string, unknown>): ParsedProjectFile | null {
  if (typeof payload.code !== "string" || !isRecord(payload.sheets)) return null;
  const sheets = parseSheetsPayload(payload.sheets);
  if (sheets === null) return null;
  return { seed: { code: payload.code, sheets }, assets: [], ...parsedName(payload) };
}

function parseProjectFileV2(payload: Record<string, unknown>): ParsedProjectFile | null {
  if (typeof payload.code !== "string" || !isRecord(payload.sheets) || !isRecord(payload.assets)) {
    return null;
  }
  const sheets = parseSheetsPayload(payload.sheets);
  if (sheets === null) return null;
  const assets = parseAssetsPayload(payload.assets);
  if (assets === null) return null;
  return { seed: { code: payload.code, sheets }, assets, ...parsedName(payload) };
}

/** Parse and validate a v1 or v2 project file. Never throws or mutates editor
 * state. Invalid optional `name` metadata is ignored while invalid content or
 * assets reject the whole file. */
export function parseImportedProjectFile(raw: string): ParsedProjectFile | { error: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: IMPORT_INVALID_MESSAGE };
  }
  if (!isRecord(payload)) return { error: IMPORT_INVALID_MESSAGE };

  const parsed =
    payload.version === LEGACY_PROJECT_FILE_VERSION
      ? parseProjectFileV1(payload)
      : payload.version === PROJECT_FILE_VERSION
        ? parseProjectFileV2(payload)
        : null;
  return parsed ?? { error: IMPORT_INVALID_MESSAGE };
}
