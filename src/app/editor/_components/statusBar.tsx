"use client";

/**
 * The editor-wide status bar (DESIGN.md §5 task 7, grid review MINOR-2): ONE
 * compact line across the editor bottom, in dark chrome, unifying what used
 * to be the preview's private status line:
 *
 *   N cards · M problems · K flagged cells · X pristine rows excluded
 *   [ + the stale indicator while the latest compile is broken ]
 *
 * Sourcing rules (why each number reads what it reads):
 * - cards — from `lastGoodModel`: the count of cards the preview is showing
 *   (keep-last-good, §4.2).
 * - problems — errors + warnings of the CURRENT compile's diagnostics: what
 *   Monaco squiggles right now, good compile or not.
 * - flagged cells — distinct cells carrying D001–D003 in the CURRENT
 *   compile's dataDiagnostics: exactly the cells the grid paints red
 *   (windowSpreadsheet reads the same source; buildFlagIndex dedupes
 *   multiple diagnostics on one cell).
 * - pristine rows excluded — the CURRENT compile's ◆29 exclusions, matching
 *   the rows the grid dims.
 * - stale — `isStale` (§4.2): the compile is broken, so preview and grid
 *   tabs are holding the last good state while the counts above track the
 *   live (broken) compile.
 *
 * The right side is the project-lifecycle surface: active project name and
 * rename action, New / Open Project, the §6.2 autosave-off note, Assets, data
 * export, and the §7.1 project-file pair. Authentication lives exclusively at
 * /admin; this component must never render sign-in/sign-out UI. Reset to demo
 * was removed with the one-slot lifecycle.
 *
 * Split (same pattern as the other windows): `StatusBar` is the thin store
 * subscription; `StatusBarContent` (exported for tests) takes the store
 * surface as props for renderToStaticMarkup-driven tests.
 */

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
} from "react";
import { buildFlagIndex } from "@/app/editor/_components/gridModel";
import { AssetsDrawerButton } from "@/app/editor/_components/assetsDrawer";
import { IconPickerButton } from "@/app/editor/_components/iconPicker";
import {
  ExportDataButton,
  exportEditorData,
} from "@/app/editor/_components/dataExport";
import {
  exportEditorProject,
  importEditorProject,
  ProjectFileButtons,
} from "@/app/editor/_components/projectFile";
import type { StoredAsset } from "@/app/editor/_store/assetStore";
import {
  useEditorStore,
  type CompileState,
  type EditorSeed,
  type LastGoodModel,
} from "@/app/editor/_store/editorStore";
import { projectLifecycle } from "@/app/editor/_store/projectLifecycle";
import type { NamedProjectSyncSnapshot } from "@/app/editor/_store/namedProjectSync";
import {
  normalizeProjectName,
  type ProjectNameResult,
} from "@/lib/projects/projectMetadata";

export interface StatusBarProps {
  /** Injectable seams for bootstrap/tests; omitted props use lifecycle state. */
  projectName?: string | null;
  onRenameProject?(name: string): ProjectNameResult | void | Promise<ProjectNameResult | void>;
  onNewOpenProject?(): void;
  cloudSync?: NamedProjectSyncSnapshot | null;
  projectLocation?: "browser" | "cloud" | null;
  onRetryCloudSync?(): void;
}

export default function StatusBar({
  projectName: injectedProjectName,
  onRenameProject: injectedRename,
  onNewOpenProject: injectedNewOpen,
  cloudSync = null,
  projectLocation: injectedProjectLocation,
  onRetryCloudSync,
}: StatusBarProps = {}): ReactElement {
  const compile = useEditorStore((s) => s.compile);
  const lastGood = useEditorStore((s) => s.lastGoodModel);
  const isStale = useEditorStore((s) => s.isStale);
  const autosaveDisabled = useEditorStore((s) => s.autosaveDisabled);
  const lifecycle = useSyncExternalStore(
    projectLifecycle.subscribe,
    projectLifecycle.getSnapshot,
    projectLifecycle.getSnapshot,
  );
  const projectName =
    injectedProjectName === undefined
      ? lifecycle.activeProject?.name ?? null
      : injectedProjectName;
  const projectLocation = injectedProjectLocation === undefined
    ? lifecycle.activeProject?.location ?? null
    : injectedProjectLocation;
  const onRenameProject =
    injectedRename ?? ((name: string) => projectLifecycle.renameActiveProject(name));
  const onNewOpenProject = injectedNewOpen ?? (() => projectLifecycle.openChooser());
  return (
    <StatusBarContent
      compile={compile}
      lastGood={lastGood}
      isStale={isStale}
      autosaveDisabled={autosaveDisabled}
      projectName={projectName}
      onRenameProject={onRenameProject}
      onNewOpenProject={onNewOpenProject}
      cloudSync={cloudSync}
      projectLocation={projectLocation}
      onRetryCloudSync={onRetryCloudSync}
      onExportProject={exportEditorProject}
      onExportData={exportEditorData}
      onImportProject={importEditorProject}
    />
  );
}

export interface StatusBarContentProps {
  compile: CompileState | null;
  lastGood: LastGoodModel | null;
  isStale: boolean;
  autosaveDisabled: boolean;
  projectName: string | null;
  onRenameProject(name: string): ProjectNameResult | void | Promise<ProjectNameResult | void>;
  onNewOpenProject(): void;
  cloudSync?: NamedProjectSyncSnapshot | null;
  projectLocation?: "browser" | "cloud" | null;
  onRetryCloudSync?(): void;
  onExportProject(): void | Promise<void>;
  onExportData(): void;
  onImportProject(seed: EditorSeed, assets: readonly StoredAsset[]): void;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function StatusBarContent({
  compile,
  lastGood,
  isStale,
  autosaveDisabled,
  projectName,
  onRenameProject,
  onNewOpenProject,
  cloudSync = null,
  projectLocation = null,
  onRetryCloudSync,
  onExportProject,
  onExportData,
  onImportProject,
}: StatusBarContentProps): ReactElement {
  const cards = (lastGood?.model.decks ?? []).reduce((n, deck) => n + deck.cards.length, 0);
  const diagnostics = compile?.diagnostics ?? [];
  const problems = diagnostics.length;
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const flaggedCells = buildFlagIndex(compile?.dataDiagnostics ?? []).size;
  const excluded = Object.values(compile?.excludedPristineRows ?? {}).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    // adversarial review item 2: this bar used to be ONE `overflow-hidden
    // whitespace-nowrap` line, so at ~1000px with the stale + autosave-off
    // indicators on, the right-hand action group (project / Assets / Export)
    // got clipped out of view
    // along with the counters. Restructured so the two halves degrade
    // differently: the counters (below) are low-stakes and allowed to
    // truncate/clip; the action group (ml-auto span) never does — it wraps
    // onto additional lines instead, and nothing in it forces nowrap, so
    // even a long confirm sentence can break onto a second line rather than
    // vanish. `flex-wrap` here is defense in depth for the same reason.
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <span>{plural(cards, "card")}</span>
        <Dot />
        <span
          className={
            problems === 0 ? undefined : hasErrors ? "text-red-400" : "text-amber-400"
          }
        >
          {plural(problems, "problem")}
        </span>
        <Dot />
        <span className={flaggedCells > 0 ? "text-red-400" : undefined}>
          {plural(flaggedCells, "flagged cell")}
        </span>
        <Dot />
        <span>{plural(excluded, "pristine row")} excluded</span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {isStale && (
          <span className="text-amber-400">
            stale — preview &amp; tabs show last good state
          </span>
        )}
        {autosaveDisabled && (
          <span
            className="text-gray-500"
            title="This browser refused storage (private mode or quota) — changes won't survive a reload."
          >
            autosave off
          </span>
        )}
        {projectLocation === "browser" && (
          <span className="text-gray-400">Local only</span>
        )}
        {cloudSync !== null && (
          <CloudSaveIndicator
            snapshot={cloudSync}
            projectName={projectName}
            onRetry={onRetryCloudSync}
          />
        )}
        <ActiveProjectChrome
          projectName={projectName}
          onRenameProject={onRenameProject}
          onNewOpenProject={onNewOpenProject}
        />
        <AssetsDrawerButton />
        <IconPickerButton />
        <ExportDataButton disabled={cards === 0} onExport={onExportData} />
        <ProjectFileButtons
          onExport={onExportProject}
          onImport={onImportProject}
          showImport={false}
        />
      </div>
    </div>
  );
}

export function CloudSaveIndicator({
  snapshot,
  projectName,
  onRetry,
}: {
  snapshot: NamedProjectSyncSnapshot;
  projectName?: string | null;
  onRetry?: () => void;
}): ReactElement {
  const name = projectName === null || projectName === undefined ? "Project" : projectName;
  if (snapshot.status === "signed-out") {
    return (
      <span className="flex items-center gap-1.5 text-amber-400" title={snapshot.error ?? undefined}>
        {name} · cloud save stopped
        <a
          href="/admin"
          className="rounded border border-amber-800 px-1.5 hover:border-amber-500"
        >
          Open Admin
        </a>
      </span>
    );
  }
  if (snapshot.status === "offline") {
    return (
      <span className="flex items-center gap-1.5 text-amber-400" title={snapshot.error ?? undefined}>
        {name} · cloud save paused
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-amber-800 px-1.5 hover:border-amber-500"
        >
          Retry
        </button>
      </span>
    );
  }
  if (snapshot.status === "conflict") {
    return <span className="text-amber-400">{name} · cloud changed — reopen project</span>;
  }
  if (snapshot.status === "saving") {
    return <span className="text-teal-300">{name} · saving to cloud…</span>;
  }
  return <span className="text-teal-400">{name} · saved to cloud</span>;
}

export const PROJECT_RENAME_FAILED = "Couldn't save the project name. Try again.";

export type RenameProjectCallback = NonNullable<StatusBarProps["onRenameProject"]>;

/** Validate first, then pass only the canonical name to persistence. */
export async function runProjectRename(
  input: string,
  onRenameProject: RenameProjectCallback,
): Promise<ProjectNameResult> {
  const validated = normalizeProjectName(input);
  if (!validated.ok) return validated;
  try {
    const persisted = await onRenameProject(validated.name);
    return persisted ?? validated;
  } catch {
    return { ok: false, name: validated.name, error: PROJECT_RENAME_FAILED };
  }
}

export interface ActiveProjectChromeProps {
  projectName: string | null;
  onRenameProject: RenameProjectCallback;
  onNewOpenProject(): void;
  /** Static-render seams for the headless component suite. */
  initialEditing?: boolean;
  initialDraft?: string;
  initialError?: string | null;
}

/** Store-free project chrome. The connected StatusBar supplies lifecycle
 * state, while bootstrap can inject persistence-aware callbacks directly. */
export function ActiveProjectChrome({
  projectName,
  onRenameProject,
  onNewOpenProject,
  initialEditing = false,
  initialDraft,
  initialError = null,
}: ActiveProjectChromeProps): ReactElement {
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(initialDraft ?? projectName ?? "");
  const [error, setError] = useState<string | null>(initialError);
  const [saving, setSaving] = useState(false);
  const validation = normalizeProjectName(draft);
  const displayedError = error ?? (validation.ok ? null : validation.error);

  useEffect(() => {
    if (!editing) setDraft(projectName ?? "");
  }, [editing, projectName]);

  const cancel = (): void => {
    setDraft(projectName ?? "");
    setError(null);
    setEditing(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!validation.ok || saving) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    const result = await runProjectRename(draft, onRenameProject);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(result.name);
    setError(null);
    setEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {editing && projectName !== null ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => void submit(event)}
        >
          <label className="sr-only" htmlFor="active-project-name">
            Project name
          </label>
          <input
            id="active-project-name"
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
            disabled={saving}
            aria-invalid={!validation.ok}
            aria-describedby={displayedError ? "active-project-name-error" : undefined}
            className="w-40 rounded border border-gray-600 bg-gray-950 px-1.5 py-0.5 text-gray-100 outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={!validation.ok || saving}
            className="rounded border border-emerald-800 px-1.5 text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200"
          >
            Cancel
          </button>
          {displayedError && (
            <span id="active-project-name-error" role="alert" className="text-red-400">
              {displayedError}
            </span>
          )}
        </form>
      ) : (
        <span className="flex items-center gap-1">
          <span
            className="max-w-48 truncate text-gray-200"
            title={projectName ?? "No active project"}
          >
            {projectName ?? "No active project"}
          </span>
          {projectName !== null && (
            <button
              type="button"
              aria-label="Edit project name"
              onClick={() => {
                setDraft(projectName);
                setError(null);
                setEditing(true);
              }}
              className="rounded border border-gray-700 px-1 text-gray-400 hover:border-gray-500 hover:text-gray-200"
            >
              Rename
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        onClick={onNewOpenProject}
        className="rounded border border-gray-700 px-1.5 text-gray-300 hover:border-emerald-600 hover:text-white"
      >
        New / Open Project
      </button>
    </div>
  );
}

function Dot(): ReactElement {
  return (
    <span aria-hidden className="text-gray-600">
      ·
    </span>
  );
}
