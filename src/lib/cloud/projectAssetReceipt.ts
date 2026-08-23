/** Short-lived proof that the server has already read and hash-verified one
 * immutable R2 object. This lets a manifest containing hundreds of assets be
 * published without downloading all of those bytes again in one function. */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProspectiveCloudAsset } from "@/lib/cloud/namedProjectAsset";
import type { AssetVerificationSubmission } from "@/lib/cloud/namedProjectAsset";
import type { CloudAssetManifestEntry } from "@/lib/cloud/projectPayload";

// Long enough for a large legacy migration plus a normal editing session.
// Receipts are still scoped to one authenticated project and immutable
// name/MIME/size/hash tuple, so extending this does not grant object access.
export const PROJECT_ASSET_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const PROJECT_ASSET_RECEIPT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function signingInput(
  projectId: string,
  asset: ProspectiveCloudAsset,
  expiresAt: number,
): string {
  return [
    "cardgoblin-project-asset-receipt-v1",
    projectId,
    asset.name,
    asset.mime,
    String(asset.size),
    asset.hash,
    String(expiresAt),
  ].join("\n");
}

function signature(
  secret: string,
  projectId: string,
  asset: ProspectiveCloudAsset,
  expiresAt: number,
): Buffer {
  return createHmac("sha256", secret)
    .update(signingInput(projectId, asset, expiresAt), "utf8")
    .digest();
}

export function createProjectAssetVerificationReceipt(
  secret: string,
  projectId: string,
  asset: ProspectiveCloudAsset,
  now = Date.now(),
): string {
  const expiresAt = now + PROJECT_ASSET_RECEIPT_TTL_MS;
  return `${expiresAt}.${signature(secret, projectId, asset, expiresAt).toString("base64url")}`;
}

export function verifyProjectAssetVerificationReceipt(
  secret: string,
  projectId: string,
  asset: ProspectiveCloudAsset,
  receipt: string,
  now = Date.now(),
): boolean {
  const match = /^([0-9]{10,16})\.([A-Za-z0-9_-]{43})$/.exec(receipt);
  if (match === null) return false;
  const expiresAt = Number(match[1]);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + PROJECT_ASSET_RECEIPT_TTL_MS + PROJECT_ASSET_RECEIPT_CLOCK_SKEW_MS
  ) {
    return false;
  }
  const provided = Buffer.from(match[2], "base64url");
  const expected = signature(secret, projectId, asset, expiresAt);
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

function sameAsset(a: CloudAssetManifestEntry, b: CloudAssetManifestEntry): boolean {
  return a.name === b.name && a.mime === b.mime && a.size === b.size && a.hash === b.hash;
}

/** Returns only references that still need an R2 byte read. An exact entry in
 * an already-published v2 manifest is trusted; a new reference is trusted only
 * with a valid receipt from the server-side post-upload readback. */
export function assetsRequiringObjectVerification(
  secret: string,
  projectId: string,
  assets: CloudAssetManifestEntry[],
  submissions: readonly AssetVerificationSubmission[],
  trustedAssets: readonly CloudAssetManifestEntry[] = [],
  now = Date.now(),
): CloudAssetManifestEntry[] | null {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const receipts = new Map<string, string>();
  for (const submission of submissions) {
    if (!byName.has(submission.name) || receipts.has(submission.name)) return null;
    receipts.set(submission.name, submission.receipt);
  }
  const trusted = new Map(trustedAssets.map((asset) => [asset.name, asset]));
  return assets.filter((asset) => {
    const prior = trusted.get(asset.name);
    if (prior !== undefined && sameAsset(asset, prior)) return false;
    const receipt = receipts.get(asset.name);
    return receipt === undefined ||
      !verifyProjectAssetVerificationReceipt(secret, projectId, asset, receipt, now);
  });
}
