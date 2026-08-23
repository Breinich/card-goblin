/** Immutable cloud identities and R2 key construction (DESIGN ◆53). */

export const LEGACY_CLOUD_PROJECT_ID = "default";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function isValidCloudProjectId(id: string): boolean {
  return id === LEGACY_CLOUD_PROJECT_ID || UUID_PATTERN.test(id);
}

/** Creation accepts only client-generated UUIDs; `default` is reserved for
 * reading and lazily upgrading the one pre-multi-project cloud slot. */
export function isValidNewCloudProjectId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export function createCloudProjectId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  const id = randomUuid().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error("Project ID generator returned an invalid UUID.");
  return id;
}

function assertProjectId(id: string): void {
  if (!isValidCloudProjectId(id)) throw new Error("Invalid cloud project ID.");
}

export function cloudProjectPrefix(id: string): string {
  assertProjectId(id);
  return `projects/${id}/`;
}

export function cloudProjectKey(id: string): string {
  return `${cloudProjectPrefix(id)}project.json`;
}

/**
 * Immutable, content-addressed object key. Logical asset names live only in
 * the revisioned manifest, so concurrent devices cannot overwrite each
 * other's bytes before one manifest wins compare-and-swap.
 */
export function cloudAssetKey(id: string, sha256: string): string {
  assertProjectId(id);
  if (!SHA256_HEX_PATTERN.test(sha256)) throw new Error("Invalid asset SHA-256.");
  return `${cloudProjectPrefix(id)}assets/${sha256}`;
}

/** Pre-◆53 compatibility resolver; never used for a new upload. */
export function legacyDefaultAssetKey(name: string): string {
  return `projects/${LEGACY_CLOUD_PROJECT_ID}/assets/${name}`;
}

export const CLOUD_PROJECTS_PREFIX = "projects/";
