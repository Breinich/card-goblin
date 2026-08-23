import { describe, expect, it } from "vitest";
import {
  LEGACY_CLOUD_PROJECT_NAME,
  parseNamedCloudProjectContent,
  parseStoredNamedCloudProjectJson,
  serializeStoredNamedCloudProject,
  type StoredNamedCloudProject,
} from "@/lib/cloud/namedProjectPayload";
import { serializeStoredCloudProject } from "@/lib/cloud/projectPayload";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const HASH = "ab".repeat(32);

const stored: StoredNamedCloudProject = {
  formatVersion: 2,
  id: ID,
  name: "My Cards 🃏",
  createdAt: "2026-08-22T12:00:00.000Z",
  updatedAt: "2026-08-22T12:00:00.000Z",
  starterId: "blank",
  revision: 1,
  creationTokenHash: "cd".repeat(32),
  creationFingerprint: "ef".repeat(32),
  code: "",
  sheets: {},
  assets: [{ name: "dragon", mime: "image/png", size: 3, hash: HASH }],
};

describe("named cloud project payload", () => {
  it("round-trips the complete named v2 envelope", () => {
    expect(parseStoredNamedCloudProjectJson(serializeStoredNamedCloudProject(stored), ID)).toEqual({
      ...stored,
      legacy: false,
    });
  });

  it("rejects mismatched IDs, noncanonical names, non-SHA hashes, and zero-byte new assets", () => {
    const decoded = JSON.parse(new TextDecoder().decode(serializeStoredNamedCloudProject(stored)));
    expect(
      parseStoredNamedCloudProjectJson(
        new TextEncoder().encode(JSON.stringify({ ...decoded, id: "default" })),
        ID,
      ),
    ).toBeNull();
    expect(parseNamedCloudProjectContent({ ...stored, name: " padded " })).toBeNull();
    expect(
      parseNamedCloudProjectContent({
        ...stored,
        assets: [{ name: "dragon", mime: "image/png", size: 3, hash: "ab" }],
      }),
    ).toBeNull();
    expect(
      parseNamedCloudProjectContent({
        ...stored,
        assets: [{ name: "dragon", mime: "image/png", size: 0, hash: HASH }],
      }),
    ).toBeNull();
  });

  it("reads the pre-◆53 default envelope without rewriting it", () => {
    const bytes = serializeStoredCloudProject({
      revision: 7,
      code: "",
      sheets: {},
      assets: [{ name: "dragon", mime: "image/png", size: 3, hash: "ab" }],
    });
    expect(parseStoredNamedCloudProjectJson(bytes, "default")).toMatchObject({
      id: "default",
      name: LEGACY_CLOUD_PROJECT_NAME,
      revision: 7,
      legacy: true,
    });
    expect(parseStoredNamedCloudProjectJson(bytes, ID)).toBeNull();
  });
});
