/** Pure validation/integrity helpers for immutable named-project assets. */

import { createHash } from "node:crypto";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_NAME_LENGTH,
  isSupportedAssetMime,
  isValidAssetName,
} from "@/app/editor/_store/assetStore";
import { isRecord } from "@/app/editor/_store/sheetsPayload";
import { SHA256_HEX_PATTERN } from "@/lib/cloud/projectIdentity";
import type { StoredObject } from "@/lib/cloud/r2";

export interface ProspectiveCloudAsset {
  name: string;
  mime: string;
  size: number;
  hash: string;
}

export interface AssetVerificationSubmission {
  name: string;
  receipt: string;
}

const VERIFICATION_RECEIPT_PATTERN = /^[0-9]{10,16}\.[A-Za-z0-9_-]{43}$/;

/** Closed, bounded sidecar carried beside a manifest update. Receipts never
 * enter the portable project or stored cloud manifest. */
export function parseAssetVerificationSubmissions(
  raw: unknown,
): AssetVerificationSubmission[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 10_000) return null;
  const names = new Set<string>();
  const parsed: AssetVerificationSubmission[] = [];
  for (const item of raw) {
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== "name,receipt") return null;
    if (
      typeof item.name !== "string" ||
      !isValidAssetName(item.name) ||
      names.has(item.name) ||
      typeof item.receipt !== "string" ||
      !VERIFICATION_RECEIPT_PATTERN.test(item.receipt)
    ) {
      return null;
    }
    names.add(item.name);
    parsed.push({ name: item.name, receipt: item.receipt });
  }
  return parsed;
}

/** The same prospective boundary as the browser asset store and strict cloud
 * manifest: identifier name ≤100 chars, one reviewed MIME, non-empty through
 * 2 MB, and a lowercase SHA-256. The request envelope is closed so misspelled
 * or stale fields do not pass silently. */
export function parseProspectiveCloudAsset(raw: unknown): ProspectiveCloudAsset | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "hash,mime,name,size") return null;
  const { name, mime, size, hash } = raw;
  if (
    typeof name !== "string" ||
    !isValidAssetName(name) ||
    name.length > ASSET_MAX_NAME_LENGTH ||
    typeof mime !== "string" ||
    !isSupportedAssetMime(mime) ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > ASSET_MAX_BYTES ||
    typeof hash !== "string" ||
    !SHA256_HEX_PATTERN.test(hash)
  ) {
    return null;
  }
  return { name, mime, size, hash };
}

export interface ImmutableAssetExpectation {
  mime: string;
  size: number;
  hash: string;
}

export function storedObjectMatchesImmutableAsset(
  stored: StoredObject,
  expected: ImmutableAssetExpectation,
): boolean {
  return (
    stored.mime === expected.mime &&
    stored.bytes.byteLength === expected.size &&
    createHash("sha256").update(stored.bytes).digest("hex") === expected.hash
  );
}
