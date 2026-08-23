/** Server-side verification of immutable asset objects before manifest CAS. */
import { createHash } from "node:crypto";
import { cloudAssetKey } from "@/lib/cloud/projectIdentity";
import type { CloudAssetManifestEntry } from "@/lib/cloud/projectPayload";
import type { CloudStorage } from "@/lib/cloud/r2";

export type ProjectAssetVerificationReason =
  | "missing"
  | "stored-mime-mismatch"
  | "size-mismatch"
  | "hash-mismatch";

export interface ProjectAssetVerificationFailure {
  name: string;
  hash: string;
  reasons: ProjectAssetVerificationReason[];
}

export type ProjectAssetVerificationResult =
  | { ok: true }
  | { ok: false; assets: ProjectAssetVerificationFailure[] };

interface VerifiedObject {
  missing: boolean;
  mime: string;
  size: number;
  hash: string;
}

export const PROJECT_ASSET_VERIFICATION_CONCURRENCY = 16;

/**
 * Checks the subset selected by the manifest route against bytes read back
 * from storage. New uploads normally arrive with server-minted verification
 * receipts and unchanged v2 references were verified by an earlier manifest
 * commit; this bounded-concurrency path is the compatibility fallback.
 * Storage/network exceptions propagate for the route's safe 502 diagnostic;
 * missing/mismatched objects are ordinary retryable 409 results.
 */
export async function verifyProjectAssetObjects(
  storage: CloudStorage,
  projectId: string,
  assets: CloudAssetManifestEntry[],
): Promise<ProjectAssetVerificationResult> {
  const checked = new Map<string, VerifiedObject>();
  const failures: ProjectAssetVerificationFailure[] = [];

  const hashes = [...new Set(assets.map((asset) => asset.hash))];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < hashes.length) {
      const hash = hashes[cursor++];
      const stored = await storage.getObject(cloudAssetKey(projectId, hash));
      checked.set(hash, stored === null
        ? { missing: true, mime: "", size: 0, hash: "" }
        : {
            missing: false,
            mime: stored.mime,
            size: stored.bytes.byteLength,
            hash: createHash("sha256").update(stored.bytes).digest("hex"),
          });
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(PROJECT_ASSET_VERIFICATION_CONCURRENCY, hashes.length) },
    worker,
  ));

  for (const asset of assets) {
    const verified = checked.get(asset.hash);
    if (verified === undefined) throw new Error("Asset verification result is missing.");

    const reasons: ProjectAssetVerificationReason[] = [];
    if (verified.missing) {
      reasons.push("missing");
    } else {
      if (verified.mime !== asset.mime) reasons.push("stored-mime-mismatch");
      if (verified.size !== asset.size) reasons.push("size-mismatch");
      if (verified.hash !== asset.hash) reasons.push("hash-mismatch");
    }
    if (reasons.length > 0) failures.push({ name: asset.name, hash: asset.hash, reasons });
  }

  return failures.length === 0 ? { ok: true } : { ok: false, assets: failures };
}
