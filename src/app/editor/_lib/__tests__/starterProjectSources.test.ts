/**
 * Build-time validation for any owner-authored starter files currently
 * present. Missing files are allowed in the early implementation seam; the
 * `verify:starter-projects` command applies the strict all-files-present gate
 * before running this same validation.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { compileProject, type EditedRows, type SheetRows } from "@/lib/lang";
import {
  isSupportedCloudImageMime,
  MAX_CLOUD_ASSET_NAME_LENGTH,
} from "@/lib/cloud/projectPayload";
import { parseImportedProjectFile } from "../projectFileFormat";
import { STARTER_PROJECTS } from "../starterProjects";
import { describe, expect, it } from "vitest";

const templateDirectory = path.resolve(process.cwd(), "template_projects");

function bytesLength(bytes: Blob | Uint8Array): number {
  return bytes instanceof Blob ? bytes.size : bytes.byteLength;
}

describe("owner-authored starter project sources", () => {
  it("matches generated availability and every present file parses and compiles cleanly", async () => {
    const directoryFiles = (await readdir(templateDirectory))
      .filter((name) => name.endsWith(".cardgoblin.json"))
      .sort();
    const descriptors = STARTER_PROJECTS.filter((starter) => starter.sourceFile !== null);
    const generatedFiles = descriptors
      .filter((starter) => starter.available)
      .map((starter) => starter.sourceFile)
      .sort();
    expect(generatedFiles).toEqual(directoryFiles);

    for (const descriptor of descriptors) {
      if (!descriptor.available || descriptor.sourceFile === null) continue;
      const raw = await readFile(path.join(templateDirectory, descriptor.sourceFile), "utf8");
      const parsed = parseImportedProjectFile(raw);
      expect(parsed, descriptor.sourceFile).not.toHaveProperty("error");
      if ("error" in parsed) continue;

      // The JSON module itself is cached by the bundler, but every creation
      // must run the production parser again and receive independent mutable
      // project state and asset bytes.
      const firstLoad = await descriptor.load();
      const secondLoad = await descriptor.load();
      expect(secondLoad).toEqual(firstLoad);
      expect(secondLoad).not.toBe(firstLoad);
      expect(secondLoad.seed).not.toBe(firstLoad.seed);
      expect(secondLoad.seed.sheets).not.toBe(firstLoad.seed.sheets);
      expect(secondLoad.assets).not.toBe(firstLoad.assets);
      for (const sheetName of Object.keys(firstLoad.seed.sheets)) {
        expect(secondLoad.seed.sheets[sheetName]).not.toBe(firstLoad.seed.sheets[sheetName]);
        expect(secondLoad.seed.sheets[sheetName].rows).not.toBe(
          firstLoad.seed.sheets[sheetName].rows,
        );
        expect(secondLoad.seed.sheets[sheetName].editedRows).not.toBe(
          firstLoad.seed.sheets[sheetName].editedRows,
        );
        for (let index = 0; index < firstLoad.seed.sheets[sheetName].rows.length; index += 1) {
          expect(secondLoad.seed.sheets[sheetName].rows[index]).not.toBe(
            firstLoad.seed.sheets[sheetName].rows[index],
          );
        }
      }
      for (let index = 0; index < firstLoad.assets.length; index += 1) {
        expect(secondLoad.assets[index]).not.toBe(firstLoad.assets[index]);
        expect(secondLoad.assets[index].bytes).not.toBe(firstLoad.assets[index].bytes);
      }

      for (const asset of parsed.assets) {
        expect(isSupportedCloudImageMime(asset.mime), `${descriptor.sourceFile}: ${asset.name} MIME`).toBe(true);
        expect(asset.name.length, `${descriptor.sourceFile}: ${asset.name} name length`).toBeLessThanOrEqual(
          MAX_CLOUD_ASSET_NAME_LENGTH,
        );
        expect(bytesLength(asset.bytes), `${descriptor.sourceFile}: ${asset.name} bytes`).toBeGreaterThan(0);
      }

      const rows: SheetRows = {};
      const editedRows: EditedRows = {};
      for (const [name, sheet] of Object.entries(parsed.seed.sheets)) {
        rows[name] = sheet.rows;
        editedRows[name] = sheet.editedRows;
      }
      const compiled = compileProject(
        parsed.seed.code,
        rows,
        editedRows,
        new Set(parsed.assets.map((asset) => asset.name)),
      );
      const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      expect(errors, `${descriptor.sourceFile} compile errors`).toEqual([]);
      expect(compiled.dataDiagnostics, `${descriptor.sourceFile} data diagnostics`).toEqual([]);
    }
  });
});
