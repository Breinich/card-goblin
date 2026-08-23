import { describe, expect, it } from "vitest";
import {
  assetsRequiringObjectVerification,
  createProjectAssetVerificationReceipt,
  PROJECT_ASSET_RECEIPT_CLOCK_SKEW_MS,
  PROJECT_ASSET_RECEIPT_TTL_MS,
  verifyProjectAssetVerificationReceipt,
} from "@/lib/cloud/projectAssetReceipt";
import { parseAssetVerificationSubmissions } from "@/lib/cloud/namedProjectAsset";

const SECRET = "asset-receipt-test-secret-at-least-32-bytes";
const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = 1_800_000_000_000;
const ASSET = {
  name: "dragon",
  mime: "image/png",
  size: 3,
  hash: "ab".repeat(32),
};

describe("project asset verification receipts", () => {
  it("binds the project and every manifest field with a bounded expiry", () => {
    const receipt = createProjectAssetVerificationReceipt(SECRET, PROJECT_ID, ASSET, NOW);
    expect(verifyProjectAssetVerificationReceipt(SECRET, PROJECT_ID, ASSET, receipt, NOW))
      .toBe(true);
    expect(verifyProjectAssetVerificationReceipt(SECRET, "default", ASSET, receipt, NOW))
      .toBe(false);
    expect(verifyProjectAssetVerificationReceipt(SECRET, PROJECT_ID, {
      ...ASSET,
      hash: "cd".repeat(32),
    }, receipt, NOW)).toBe(false);
    expect(verifyProjectAssetVerificationReceipt(
      SECRET,
      PROJECT_ID,
      ASSET,
      receipt,
      NOW + PROJECT_ASSET_RECEIPT_TTL_MS,
    )).toBe(false);
    const skewedReceipt = createProjectAssetVerificationReceipt(
      SECRET,
      PROJECT_ID,
      ASSET,
      NOW + PROJECT_ASSET_RECEIPT_CLOCK_SKEW_MS,
    );
    expect(verifyProjectAssetVerificationReceipt(
      SECRET,
      PROJECT_ID,
      ASSET,
      skewedReceipt,
      NOW,
    )).toBe(true);
  });

  it("requires reads only for new entries without a valid receipt", () => {
    const receipt = createProjectAssetVerificationReceipt(SECRET, PROJECT_ID, ASSET, NOW);
    const newAsset = { ...ASSET, name: "goblin", hash: "cd".repeat(32) };
    expect(assetsRequiringObjectVerification(
      SECRET,
      PROJECT_ID,
      [ASSET, newAsset],
      [{ name: "goblin", receipt: "1800001800000." + "x".repeat(43) }],
      [ASSET],
      NOW,
    )).toEqual([newAsset]);
    expect(assetsRequiringObjectVerification(
      SECRET,
      PROJECT_ID,
      [ASSET],
      [{ name: "dragon", receipt }],
      [],
      NOW,
    )).toEqual([]);
    expect(assetsRequiringObjectVerification(
      SECRET,
      PROJECT_ID,
      [ASSET],
      [{ name: "not_in_manifest", receipt }],
      [],
      NOW,
    )).toBeNull();
  });

  it("strictly parses the bounded request sidecar", () => {
    const receipt = createProjectAssetVerificationReceipt(SECRET, PROJECT_ID, ASSET, NOW);
    expect(parseAssetVerificationSubmissions(undefined)).toEqual([]);
    expect(parseAssetVerificationSubmissions([{ name: ASSET.name, receipt }])).toEqual([
      { name: ASSET.name, receipt },
    ]);
    expect(parseAssetVerificationSubmissions([{ name: ASSET.name, receipt, extra: true }]))
      .toBeNull();
    expect(parseAssetVerificationSubmissions([
      { name: ASSET.name, receipt },
      { name: ASSET.name, receipt },
    ])).toBeNull();
  });
});
