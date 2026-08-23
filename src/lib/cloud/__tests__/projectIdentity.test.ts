import { describe, expect, it } from "vitest";
import {
  cloudAssetKey,
  cloudProjectKey,
  createCloudProjectId,
  isValidCloudProjectId,
  isValidNewCloudProjectId,
  legacyDefaultAssetKey,
} from "@/lib/cloud/projectIdentity";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const HASH = "ab".repeat(32);

describe("cloud project identity", () => {
  it("accepts the closed UUID form and the legacy default ID", () => {
    expect(isValidCloudProjectId(ID)).toBe(true);
    expect(isValidCloudProjectId("default")).toBe(true);
    expect(isValidNewCloudProjectId(ID)).toBe(true);
    expect(isValidNewCloudProjectId("default")).toBe(false);
    for (const bad of ["../x", "ABC", "123", `${ID}/assets`, ID.toUpperCase()]) {
      expect(isValidCloudProjectId(bad)).toBe(false);
    }
  });

  it("validates the generator and normalizes its UUID to lowercase", () => {
    expect(createCloudProjectId(() => ID.toUpperCase())).toBe(ID);
    expect(() => createCloudProjectId(() => "../bad")).toThrow(/invalid UUID/);
  });

  it("builds only validated project and immutable hash keys", () => {
    expect(cloudProjectKey(ID)).toBe(`projects/${ID}/project.json`);
    expect(cloudAssetKey(ID, HASH)).toBe(`projects/${ID}/assets/${HASH}`);
    expect(() => cloudAssetKey(ID, "not-a-hash")).toThrow(/SHA-256/);
    expect(() => cloudProjectKey("../bad")).toThrow(/project ID/);
    expect(legacyDefaultAssetKey("dragon")).toBe("projects/default/assets/dragon");
  });
});
