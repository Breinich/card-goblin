import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROJECT_ASSET_VERIFICATION_CONCURRENCY,
  verifyProjectAssetObjects,
} from "@/lib/cloud/projectAssetVerification";
import { createInMemoryCloudStorage, type CloudStorage } from "@/lib/cloud/r2";
import { cloudAssetKey } from "@/lib/cloud/projectIdentity";

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("large manifest verification", () => {
  it("uses bounded parallel reads and preserves full byte verification", async () => {
    const records = Array.from({ length: 101 }, (_unused, index) => {
      const bytes = new TextEncoder().encode(`asset-${index}`);
      return {
        asset: {
          name: `asset_${index}`,
          mime: "image/png",
          size: bytes.byteLength,
          hash: createHash("sha256").update(bytes).digest("hex"),
        },
        bytes,
      };
    });
    const base = createInMemoryCloudStorage();
    for (const { asset, bytes } of records) {
      await base.putObject(cloudAssetKey(PROJECT_ID, asset.hash), bytes, asset.mime);
    }
    let active = 0;
    let maximumActive = 0;
    const storage: CloudStorage = {
      ...base,
      getObject: async (key) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        try {
          return await base.getObject(key);
        } finally {
          active -= 1;
        }
      },
    };

    await expect(verifyProjectAssetObjects(
      storage,
      PROJECT_ID,
      records.map(({ asset }) => asset),
    )).resolves.toEqual({ ok: true });
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(PROJECT_ASSET_VERIFICATION_CONCURRENCY);
  });
});
