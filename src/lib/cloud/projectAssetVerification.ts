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

/**
 * Every manifest reference is checked against bytes read back from storage.
 * The upload presign binds Content-Type to the reviewed logical image MIME,
 * so readback must match that manifest MIME as well as size/hash. Storage or
 * network exceptions propagate so routes can retain the shared safe 502
 * diagnostic; missing/mismatched objects are ordinary retryable 409 results.
 */
export async function verifyProjectAssetObjects(
  storage: CloudStorage,
  projectId: string,
  assets: CloudAssetManifestEntry[],
): Promise<ProjectAssetVerificationResult> {
  const checked = new Map<string, VerifiedObject>();
  const failures: ProjectAssetVerificationFailure[] = [];

  for (const asset of assets) {
    let verified = checked.get(asset.hash);
    if (verified === undefined) {
      const stored = await storage.getObject(cloudAssetKey(projectId, asset.hash));
      verified = stored === null
        ? { missing: true, mime: "", size: 0, hash: "" }
        : {
            missing: false,
            mime: stored.mime,
            size: stored.bytes.byteLength,
            hash: createHash("sha256").update(stored.bytes).digest("hex"),
          };
      checked.set(asset.hash, verified);
    }

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
