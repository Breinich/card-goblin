/**
 * Test-only copy of the pre-project-lifecycle project-file reader.
 *
 * Do not update this helper to follow the production codec. It is an oracle
 * for the old application's acceptance boundary, including unknown top-level
 * fields being ignored and all `image/*` MIME strings being accepted.
 */

interface FrozenSheet {
  rows: Record<string, string>[];
  editedRows: boolean[];
}

export interface FrozenParsedProjectFile {
  code: string;
  sheets: Record<string, FrozenSheet>;
  assets: { name: string; mime: string; bytes: Uint8Array }[];
}

export function frozenCurrentV1Writer(
  code: string,
  sheets: Record<string, FrozenSheet>,
): string {
  return JSON.stringify({ version: 1, code, sheets });
}

export function frozenCurrentV2Writer(
  code: string,
  sheets: Record<string, FrozenSheet>,
  assets: readonly { name: string; mime: string; bytes: Uint8Array }[],
): string {
  const persistedAssets: Record<string, { mime: string; bytes: string }> = {};
  for (const asset of assets) {
    let binary = "";
    for (let i = 0; i < asset.bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...asset.bytes.subarray(i, i + 0x8000));
    }
    persistedAssets[asset.name] = { mime: asset.mime, bytes: btoa(binary) };
  }
  return JSON.stringify({ version: 2, code, sheets, assets: persistedAssets });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseSheets(raw: Record<string, unknown>): Record<string, FrozenSheet> | null {
  const sheets: Record<string, FrozenSheet> = Object.create(null) as Record<string, FrozenSheet>;
  for (const [name, sheet] of Object.entries(raw)) {
    if (!isRecord(sheet) || !Array.isArray(sheet.rows) || !Array.isArray(sheet.editedRows)) {
      return null;
    }
    const rows: Record<string, string>[] = [];
    for (const row of sheet.rows) {
      if (!isRecord(row) || Object.values(row).some((value) => typeof value !== "string")) {
        return null;
      }
      rows.push({ ...(row as Record<string, string>) });
    }
    sheets[name] = { rows, editedRows: sheet.editedRows.map((flag) => flag === true) };
  }
  return sheets;
}

function decodeBase64(value: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function frozenCurrentProjectFileReader(raw: string): FrozenParsedProjectFile | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload) || typeof payload.code !== "string" || !isRecord(payload.sheets)) {
    return null;
  }
  const sheets = parseSheets(payload.sheets);
  if (sheets === null) return null;

  if (payload.version === 1) return { code: payload.code, sheets, assets: [] };
  if (payload.version !== 2 || !isRecord(payload.assets)) return null;

  const assets: FrozenParsedProjectFile["assets"] = [];
  for (const [name, entry] of Object.entries(payload.assets)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return null;
    if (!isRecord(entry) || typeof entry.mime !== "string" || typeof entry.bytes !== "string") {
      return null;
    }
    if (!entry.mime.startsWith("image/")) return null;
    const bytes = decodeBase64(entry.bytes);
    if (bytes === null || bytes.byteLength > 2 * 1024 * 1024) return null;
    assets.push({ name, mime: entry.mime, bytes });
  }
  return { code: payload.code, sheets, assets };
}
