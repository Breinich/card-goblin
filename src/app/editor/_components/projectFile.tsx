"use client";

/**
 * Project file export/import (DESIGN.md §7.1, §7.1b — M3): the status bar's
 * Portable project-file export/import controls. The named-project editor uses
 * Export here and routes Import through its blocking New / Open chooser.
 *
 * **v2 (§7.1b, current export format):** `{version: 2, code, sheets, assets}`
 * — self-contained, art included. `assets` is `{name: {mime, bytes: base64}}`,
 * gathered from the Assets-drawer's IndexedDB library at export time.
 * **v1 compatibility:** files from before §7.1b (`{version: 1, code, sheets}`,
 * no `assets` key — the SAME shape persistence.ts's autosave slot still
 * writes) import forever; importing one CLEARS the asset library, consistent
 * with "import replaces the whole project" (there is nothing to carry over).
 * The portable codec lives in projectFileFormat.ts and shares the same pure
 * sheet-shape parser as persistence/cloud without importing their connected
 * stores. This component re-exports that public surface for compatibility.
 *
 * Decisions beyond §7.1/§7.1b's literal text (each mirrored in the wiki page):
 * - Filename derives from the CURRENT compile's model (after a flush), not
 *   `lastGoodModel`: the payload is the current code + sheets, so the name
 *   should follow what the exported code declares. Broken code that yields no
 *   single deck falls back to the generic name — honest, and only cosmetic.
 * - Export/import are ASYNC (§7.1b, new): gathering asset bytes from
 *   IndexedDB (export) and replacing the library (import) are both
 *   inherently async, unlike the v1-only, purely-synchronous payload.
 * - Import commits via the store's `replaceProject`, deliberately NOT muted
 *   (contrast: persistence.ts resetToDemo): the attached autosave
 *   subscription sees the change and persists the imported project through
 *   the normal 1 s debounce, no edit needed (§7.1). The asset-library
 *   replacement (`assetStore.replaceAll`) is independent of that — assets
 *   live in IDB, not the localStorage autosave slot (§7.1b).
 * - Validation is strict and whole-file (§6.2's "no partial restores" rule,
 *   extended to `assets`): any bad asset entry (invalid name, non-string
 *   mime/bytes, bad base64, or over the 2 MB cap) invalidates the ENTIRE
 *   file, exactly like a bad sheet row does — never a partial import. File
 *   import has no quarantine (that's the autosave-restore-only posture,
 *   §6.2); an invalid file just leaves the current project (and library)
 *   untouched.
 * - The invalid-file error is an inline status-bar message (role="alert"),
 *   never a browser alert — same chrome rule as the reset confirm. It clears
 *   on the next pick.
 * - The file input is hidden and clicked from an ordinary button (keyboard
 *   accessible; display:none keeps it out of the tab order), and its value is
 *   reset per pick so re-choosing the same file fires `change` again.
 * - `initialError` / `initialPending` are test seams (no interaction driver
 *   in this project) so all three states render statically — the same pattern
 *   as the editor's other static-render state seams.
 */

import { useRef, useState, type ReactElement } from "react";
import {
  editorStore,
  type EditorSeed,
} from "@/app/editor/_store/editorStore";
import {
  assetStore,
  type AssetStore,
  type AssetStoreSnapshot,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";
import { projectLifecycle } from "@/app/editor/_store/projectLifecycle";
import {
  buildProjectExport,
  IMPORT_INVALID_MESSAGE,
  parseImportedProjectFile,
  type ParsedProjectFile,
} from "@/app/editor/_lib/projectFileFormat";

// Preserve the original public surface while keeping the codec itself free of
// React and editor/browser singletons for startup and build-time consumers.
export {
  buildProjectExport,
  IMPORT_INVALID_MESSAGE,
  PROJECT_FILE_VERSION,
  parseImportedProjectFile,
  parsePortableProjectName,
  projectFileName,
  type ParsedProjectFile,
} from "@/app/editor/_lib/projectFileFormat";

// ---------------------------------------------------------------------------
// Singleton-store actions (browser click handlers — same shape as
// persistence.ts's resetEditorToDemo)
// ---------------------------------------------------------------------------

/** Export is complete-or-fails, never silently partial (§7.4 amendment,
 * 2026-08-15): this file is billed as the user's backup, and importing one
 * REPLACES the whole asset library — so a v2 file downloaded with
 * `assets: {}` while the library holds art is deferred data loss, not a
 * backup. `runExport` surfaces this error's message verbatim. */
export class ExportAbortedError extends Error {}

export const EXPORT_ASSETS_UNREADABLE_MESSAGE =
  "Couldn't read your uploaded images — export aborted so you don't get a backup without them. Reload and try again.";
export const EXPORT_PROJECT_CHANGED_MESSAGE =
  "The project changed while its backup was being prepared. Export again to capture one consistent version.";

/** Every asset the snapshot lists, bytes resolved — complete or throw
 * (ExportAbortedError). `getBytes` answers null, never throws, BOTH for a
 * name that vanished mid-export and for a store an IDB failure just flipped
 * disabled — and the snapshot keeps its pre-disable meta list, so "listed
 * but unreadable" covers the whole-library-lost case, not just a rare race.
 * Any null for a listed asset therefore aborts the export; an empty library
 * resolves to `[]` and exports fine. The store is injectable for tests
 * (no IndexedDB in the headless suite). */
export async function collectExportAssets(
  store: Pick<AssetStore, "getSnapshot" | "getBytes"> = assetStore,
  expectedSnapshot: AssetStoreSnapshot = store.getSnapshot(),
): Promise<StoredAsset[]> {
  const assets: StoredAsset[] = [];
  for (const meta of expectedSnapshot.assets) {
    const asset = await store.getBytes(meta.name);
    const size = asset?.bytes instanceof Blob ? asset.bytes.size : asset?.bytes.byteLength;
    if (
      asset === null ||
      asset.name !== meta.name ||
      asset.mime !== meta.mime ||
      size !== meta.size
    ) {
      throw new ExportAbortedError(EXPORT_ASSETS_UNREADABLE_MESSAGE);
    }
    assets.push(asset);
  }
  return assets;
}

/** Download the CURRENT project, assets included. Flushes any pending
 * compile first so the filename's deck-count check matches the code being
 * exported. Rejects (via collectExportAssets) rather than downloading a
 * file missing any listed asset. */
export async function exportEditorProject(): Promise<void> {
  editorStore.getState().flushCompile();
  const editorBefore = editorStore.getState();
  const projectBefore = projectLifecycle.getSnapshot().activeProject;
  const assetsBefore = assetStore.getSnapshot();
  const assets = await collectExportAssets(assetStore, assetsBefore);
  const editorAfter = editorStore.getState();
  const projectAfter = projectLifecycle.getSnapshot().activeProject;
  if (
    assetStore.getSnapshot() !== assetsBefore ||
    editorAfter.code !== editorBefore.code ||
    editorAfter.sheets !== editorBefore.sheets ||
    projectAfter?.id !== projectBefore?.id ||
    projectAfter?.location !== projectBefore?.location ||
    projectAfter?.name !== projectBefore?.name
  ) {
    throw new ExportAbortedError(EXPORT_PROJECT_CHANGED_MESSAGE);
  }
  const { filename, json } = await buildProjectExport(
    editorBefore.code,
    editorBefore.sheets,
    editorBefore.compile?.model ?? null,
    assets,
    projectBefore?.name,
  );
  downloadJson(json, filename);
}

/** Commit a confirmed import. Deliberately NOT muted (module note): the
 * autosave subscription persists the imported project ~1 s later (§7.1).
 * The asset library is REPLACED too (§7.1b) — empty `assets` (a v1 file)
 * clears it, matching "import replaces the whole project". */
export function importEditorProject(seed: EditorSeed, assets: readonly StoredAsset[]): void {
  editorStore.getState().replaceProject(seed);
  void assetStore.replaceAll(assets);
}

/** Mirrors pdfExportModal's downloadPdf: blob URL + anchor click, with the
 * deferred revoke (synchronous revoking can cancel the download). */
function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/** A parsed-but-unconfirmed import: the seed + assets wait behind the §7.1
 * two-step confirm, the filename names it in the question. */
export interface PendingImport extends ParsedProjectFile {
  filename: string;
}

export interface ProjectFileButtonsProps {
  /** §7.1b: async (gathering asset bytes) — a rejection is caught and shown
   * inline (adversarial m7), same surface as an invalid import. */
  onExport(): void | Promise<void>;
  onImport(seed: EditorSeed, assets: readonly StoredAsset[]): void;
  /** Test seam: render the inline error state statically. */
  initialError?: string | null;
  /** Test seam: render the armed confirm state statically. */
  initialPending?: PendingImport | null;
  /** Named-project lifecycle routes imports through its chooser so the user
   * must supply metadata and the load can be staged atomically. */
  showImport?: boolean;
}

/** m7: the export path (async since §7.1b — gathering asset bytes from IDB
 * can fail) had no rejection handler, so a thrown/rejected `onExport` was an
 * unhandled promise rejection with no user-visible sign anything went wrong. */
export const EXPORT_FAILED_MESSAGE = "Export failed — nothing was downloaded.";

/** Pure form of the export button's rejection handling — exported so the
 * catch behavior is unit-testable without a click driver (this project has
 * none): resolves to `null` on success, an ExportAbortedError's own message
 * (it is written for the user), and `EXPORT_FAILED_MESSAGE` on any other
 * throw/rejection from `onExport`. */
export async function runExport(onExport: () => void | Promise<void>): Promise<string | null> {
  try {
    await onExport();
    return null;
  } catch (err) {
    return err instanceof ExportAbortedError ? err.message : EXPORT_FAILED_MESSAGE;
  }
}

const QUIET_BUTTON =
  "rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200";

/**
 * Portable Export and the legacy inline Import control (§7.1, §7.1b).
 * `showImport={false}` is the named-project status-bar posture; the chooser
 * owns naming and atomic import. Tests and older embedded callers can retain
 * the self-contained inline import surface.
 */
export function ProjectFileButtons({
  onExport,
  onImport,
  initialError = null,
  initialPending = null,
  showImport = true,
}: ProjectFileButtonsProps): ReactElement {
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState<PendingImport | null>(
    showImport ? initialPending : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPending(null);
      setError(IMPORT_INVALID_MESSAGE);
      return;
    }
    const parsed = parseImportedProjectFile(text);
    if ("error" in parsed) {
      setPending(null);
      setError(parsed.error);
    } else {
      setError(null);
      setPending({ ...parsed, filename: file.name });
    }
  };

  // m7 (adversarial): `onExport` is async (§7.1b gathers asset bytes from
  // IDB, which can fail) — awaiting it here, instead of firing it straight
  // off `onClick`, turns a rejection into the SAME inline `role="alert"`
  // surface an invalid import already uses, rather than an unhandled
  // promise rejection with no visible sign anything went wrong.
  const handleExport = async (): Promise<void> => {
    setError(await runExport(onExport));
  };

  if (pending !== null) {
    return (
      // flex-wrap (adversarial review item 2): the answer buttons of an
      // armed confirm must never clip out of the status bar — a long
      // filename here (a real, user-supplied string) can no longer push
      // Import/Keep out of view; it wraps onto another line instead.
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-amber-400">
          Replace your project (and your uploaded assets) with “{pending.filename}”?
        </span>
        <button
          type="button"
          onClick={() => {
            setPending(null);
            onImport(pending.seed, pending.assets);
          }}
          className="rounded border border-red-900 px-1.5 text-red-400 hover:border-red-500 hover:text-red-300"
        >
          Import
        </button>
        <button type="button" onClick={() => setPending(null)} className={QUIET_BUTTON}>
          Keep
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {error !== null && (
        <span role="alert" className="text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleExport()}
        title="Download this project (and its assets) as a .cardgoblin.json file"
        className={QUIET_BUTTON}
      >
        Export project
      </button>
      {showImport && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Load a .cardgoblin.json file, replacing this project and its assets"
            className={QUIET_BUTTON}
          >
            Import project
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Reset per pick (module note) BEFORE the async read detaches us
              // from the pooled event.
              event.currentTarget.value = "";
              if (file !== undefined) void handleFile(file);
            }}
          />
        </>
      )}
    </span>
  );
}
