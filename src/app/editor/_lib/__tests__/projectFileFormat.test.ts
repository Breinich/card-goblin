import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildProjectExport,
  IMPORT_INVALID_MESSAGE,
  parseImportedProjectFile,
  parsePortableProjectName,
  PROJECT_FILE_VERSION,
} from "@/app/editor/_lib/projectFileFormat";
import type { StoredAsset } from "@/app/editor/_store/assetStore";
import {
  frozenCurrentProjectFileReader,
  frozenCurrentV1Writer,
  frozenCurrentV2Writer,
} from "./fixtures/frozenCurrentProjectFileReader";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").trimEnd();

const assetBytes = (asset: StoredAsset): Uint8Array => {
  if (asset.bytes instanceof Blob) throw new Error("parsed assets must use Uint8Array bytes");
  return asset.bytes;
};

describe("project-file golden compatibility", () => {
  const goldenCode = "Sheet: Cards\n  column title: Text\n";
  const goldenSheets = {
    Cards: {
      rows: [
        { title: "Café", __orphan__legacy: "保留" },
        { title: "" },
      ] as Record<string, string>[],
      editedRows: [true, false],
    },
  };

  it("pins both golden files to frozen pre-feature writers", () => {
    expect(fixture("current-v1.cardgoblin.json")).toBe(
      frozenCurrentV1Writer(goldenCode, goldenSheets),
    );
    expect(fixture("current-v2.cardgoblin.json")).toBe(
      frozenCurrentV2Writer(goldenCode, goldenSheets, [
        { name: "crest", mime: "image/png", bytes: new Uint8Array([0, 1, 2, 3, 255]) },
        { name: "empty_legacy", mime: "image/x-cardgoblin-legacy", bytes: new Uint8Array() },
      ]),
    );
  });

  for (const filename of ["current-v1.cardgoblin.json", "current-v2.cardgoblin.json"]) {
    it(`parses the committed pre-feature ${filename} fixture`, () => {
      const parsed = parseImportedProjectFile(fixture(filename));
      expect("seed" in parsed).toBe(true);
      if (!("seed" in parsed)) return;
      expect(parsed.seed.code).toBe(goldenCode);
      expect(parsed.seed.sheets.Cards.rows).toEqual(goldenSheets.Cards.rows);
      expect(parsed.seed.sheets.Cards.editedRows).toEqual([true, false]);
    });
  }

  it("re-exports the golden v2 content and every asset byte exactly", async () => {
    const golden = parseImportedProjectFile(fixture("current-v2.cardgoblin.json"));
    if (!("seed" in golden)) throw new Error("golden v2 fixture did not parse");

    const { json } = await buildProjectExport(
      golden.seed.code,
      golden.seed.sheets,
      null,
      golden.assets,
    );
    expect(json).toBe(fixture("current-v2.cardgoblin.json"));

    const reparsed = parseImportedProjectFile(json);
    if (!("seed" in reparsed)) throw new Error("re-export did not parse");
    expect(reparsed.seed).toEqual(golden.seed);
    expect(reparsed.assets.map((asset) => [asset.name, asset.mime, [...assetBytes(asset)]])).toEqual(
      golden.assets.map((asset) => [asset.name, asset.mime, [...assetBytes(asset)]]),
    );
  });

  it("upgrades the golden v1 fixture to v2 without changing project content", async () => {
    const golden = parseImportedProjectFile(fixture("current-v1.cardgoblin.json"));
    if (!("seed" in golden)) throw new Error("golden v1 fixture did not parse");

    const { json } = await buildProjectExport(
      golden.seed.code,
      golden.seed.sheets,
      null,
      golden.assets,
    );
    const reparsed = parseImportedProjectFile(json);
    expect(reparsed).toEqual(golden);
    expect(frozenCurrentProjectFileReader(json)).toMatchObject({
      code: golden.seed.code,
      sheets: golden.seed.sheets,
      assets: [],
    });
  });
});

describe("optional portable project name", () => {
  it("writes a normalized name without changing v2 and the frozen current reader ignores it", async () => {
    const asset: StoredAsset = {
      name: "art",
      mime: "image/png",
      bytes: new Uint8Array([0, 127, 128, 255]),
    };
    const { json } = await buildProjectExport("code", {}, null, [asset], "  Cafe\u0301 Cards  ");
    const payload = JSON.parse(json) as Record<string, unknown>;
    expect(payload.version).toBe(PROJECT_FILE_VERSION);
    expect(payload.name).toBe("Café Cards");

    const old = frozenCurrentProjectFileReader(json);
    expect(old?.code).toBe("code");
    expect(old?.assets[0]).toMatchObject({ name: "art", mime: "image/png" });
    expect(old?.assets[0].bytes).toEqual(asset.bytes);
    expect(Object.hasOwn(old ?? {}, "name")).toBe(false);
  });

  it("exposes a valid name while missing or invalid metadata never rejects valid content", () => {
    const base = { version: 2, code: "", sheets: {}, assets: {} };
    const valid = parseImportedProjectFile(JSON.stringify({ ...base, name: "  Δ Project  " }));
    expect(valid).toMatchObject({ name: "Δ Project", seed: { code: "", sheets: {} }, assets: [] });

    for (const invalidName of [undefined, null, 42, "", "   ", "bad\u0000name", "x".repeat(81)]) {
      const parsed = parseImportedProjectFile(JSON.stringify({ ...base, name: invalidName }));
      expect("seed" in parsed).toBe(true);
      expect(Object.hasOwn(parsed, "name")).toBe(false);
    }
  });

  it("continues to ignore unrelated unknown top-level fields", () => {
    const parsed = parseImportedProjectFile(
      JSON.stringify({
        version: 2,
        code: "kept",
        sheets: {},
        assets: {},
        futureMetadata: { revision: 99 },
      }),
    );
    expect(parsed).toMatchObject({ seed: { code: "kept", sheets: {} }, assets: [] });
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(parsePortableProjectName("😀".repeat(80))).toBe("😀".repeat(80));
    expect(parsePortableProjectName("😀".repeat(81))).toBeUndefined();
  });

  it("keeps historical JSON byte shape when no valid name is supplied", async () => {
    const parsed = parseImportedProjectFile(fixture("current-v2.cardgoblin.json"));
    if (!("seed" in parsed)) throw new Error("golden v2 fixture did not parse");
    await expect(
      buildProjectExport(parsed.seed.code, parsed.seed.sheets, null, parsed.assets, "\u0000"),
    ).resolves.toMatchObject({ json: fixture("current-v2.cardgoblin.json") });
  });
});

describe("frozen legacy asset acceptance boundary", () => {
  const parseOne = (name: string, mime: string, bytes: Uint8Array) =>
    parseImportedProjectFile(
      JSON.stringify({
        version: 2,
        code: "",
        sheets: {},
        assets: { [name]: { mime, bytes: Buffer.from(bytes).toString("base64") } },
      }),
    );

  it("recovers zero-byte, long-name, and historically accepted image MIME assets", () => {
    const longName = `asset_${"x".repeat(140)}`;
    for (const [name, mime] of [
      ["empty", "image/bmp"],
      [longName, "image/tiff"],
      ["parameterized", "image/png; charset=x"],
      ["case_variant", "image/PNG"],
      ["future_type", "image/x-vendor-card-format"],
    ]) {
      const parsed = parseOne(name, mime, new Uint8Array());
      expect("assets" in parsed && parsed.assets[0]).toMatchObject({ name, mime });
      if ("assets" in parsed) expect(assetBytes(parsed.assets[0])).toHaveLength(0);
    }
  });

  it("round-trips deterministic arbitrary byte patterns exactly", async () => {
    let state = 0x5a17;
    for (let caseIndex = 0; caseIndex < 12; caseIndex++) {
      const bytes = new Uint8Array(caseIndex * 31 + 1);
      for (let i = 0; i < bytes.length; i++) {
        state = (state * 1103515245 + 12345) >>> 0;
        bytes[i] = state & 0xff;
      }
      const original: StoredAsset = {
        name: `generated_${caseIndex}`,
        mime: `image/x-generated-${caseIndex}`,
        bytes,
      };
      const { json } = await buildProjectExport("", {}, null, [original]);
      const parsed = parseImportedProjectFile(json);
      if (!("assets" in parsed)) throw new Error("generated case did not parse");
      expect(assetBytes(parsed.assets[0])).toEqual(bytes);
    }
  });

  it("generates a broad historical name/MIME/byte matrix through both new and frozen readers", async () => {
    const nameAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    const mimeAlphabet = "abcXYZ012+.-;= _";
    let state = 0x6d2b79f5;
    const next = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return (state ^ (state >>> 14)) >>> 0;
    };
    for (let caseIndex = 0; caseIndex < 96; caseIndex++) {
      const nameLength = caseIndex === 95 ? 180 : 1 + (next() % 60);
      let name = String.fromCharCode(65 + (caseIndex % 26));
      while (name.length < nameLength) name += nameAlphabet[next() % nameAlphabet.length];
      const suffixLength = caseIndex % 17;
      let suffix = "";
      while (suffix.length < suffixLength) suffix += mimeAlphabet[next() % mimeAlphabet.length];
      const bytes = new Uint8Array(next() % 257);
      for (let index = 0; index < bytes.length; index++) bytes[index] = next() & 0xff;
      const original: StoredAsset = { name, mime: `image/${suffix}`, bytes };

      const { json } = await buildProjectExport("", {}, null, [original], `Generated ${caseIndex}`);
      const current = parseImportedProjectFile(json);
      if (!("assets" in current)) throw new Error(`generated case ${caseIndex} did not parse`);
      expect(current.assets[0]).toMatchObject({ name, mime: original.mime });
      expect(assetBytes(current.assets[0])).toEqual(bytes);

      const frozen = frozenCurrentProjectFileReader(json);
      expect(frozen?.assets[0]).toMatchObject({ name, mime: original.mime });
      expect(frozen?.assets[0]?.bytes).toEqual(bytes);
    }
  });

  it("continues rejecting __proto__, which never matched the historical letter-first name grammar", () => {
    expect(parseOne("__proto__", "image/png", new Uint8Array([1]))).toEqual({
      error: IMPORT_INVALID_MESSAGE,
    });
  });

  it("accepts the old inclusive 2 MB cap and rejects one byte over", () => {
    const atCap = parseOne("maximum", "image/heic", new Uint8Array(2 * 1024 * 1024));
    expect("assets" in atCap && assetBytes(atCap.assets[0])).toHaveLength(2 * 1024 * 1024);

    const overCap = parseOne("too_large", "image/heic", new Uint8Array(2 * 1024 * 1024 + 1));
    expect(overCap).toEqual({ error: IMPORT_INVALID_MESSAGE });
  });
});
