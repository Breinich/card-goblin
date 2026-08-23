"use client";

/** Blocking project chooser (DESIGN ◆53). Store-free and testable by props. */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { focusableElementsIn } from "@/app/editor/_components/dialogFocusTrap";
import type { StarterProjectDescriptor, StarterProjectId } from "@/app/editor/_lib/starterProjects";
import type {
  CloudProjectSummary,
  ProjectLifecycleSnapshot,
} from "@/app/editor/_store/projectLifecycle";
import { normalizeProjectName } from "@/lib/projects/projectMetadata";
import type { ProjectOpenConflict } from "@/app/editor/_store/projectBootstrap";

export interface ProjectChooserProps {
  snapshot: ProjectLifecycleSnapshot;
  starters: readonly StarterProjectDescriptor[];
  selectedStarterId: StarterProjectId;
  projectName: string;
  importedFileName: string | null;
  onSelectStarter(id: StarterProjectId, suggestedName: string): void;
  onProjectNameChange(name: string): void;
  onCreateStarter(id: StarterProjectId, name: string): void;
  onPickImportFile(file: File): void | Promise<void>;
  onConfirmImport(name: string): void;
  onContinueBrowser(): void;
  onOpenCloud(project: CloudProjectSummary): void;
  onRetrySession(): void;
  onRetryCloudList(): void;
  onCancel(): void;
  inputError?: string | null;
  requiresBrowserReplacementConfirmation?: boolean;
  cloudConflict?: ProjectOpenConflict | null;
  onResolveCloudConflict?(choice: "browser" | "cloud"): void;
}

const BUTTON =
  "rounded border border-gray-600 bg-gray-800 px-3 py-2 text-left text-sm text-gray-200 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY =
  "rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400";

function loadingCopy(snapshot: ProjectLifecycleSnapshot): string | null {
  switch (snapshot.phase) {
    case "checking-session":
      return "Checking admin session…";
    case "loading-cloud-projects":
      return "Loading cloud projects…";
    case "opening":
      return "Opening project…";
    case "creating-cloud-project":
      return "Creating and verifying cloud project…";
    default:
      return null;
  }
}

/** Initial chooser has no active project and cannot close; post-start chooser can. */
export function canCancelProjectChooser(snapshot: ProjectLifecycleSnapshot): boolean {
  return snapshot.activeProject !== null;
}

export function ProjectChooser({
  snapshot,
  starters,
  selectedStarterId,
  projectName,
  importedFileName,
  onSelectStarter,
  onProjectNameChange,
  onCreateStarter,
  onPickImportFile,
  onConfirmImport,
  onContinueBrowser,
  onOpenCloud,
  onRetrySession,
  onRetryCloudList,
  onCancel,
  inputError = null,
  requiresBrowserReplacementConfirmation = false,
  cloudConflict = null,
  onResolveCloudConflict,
}: ProjectChooserProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canCancel = canCancelProjectChooser(snapshot);
  const canCancelNow = canCancel &&
    snapshot.phase !== "opening" &&
    snapshot.phase !== "creating-cloud-project";
  const nameResult = normalizeProjectName(projectName);
  const selected = starters.find((starter) => starter.id === selectedStarterId);
  const loading = loadingCopy(snapshot);
  const [replacementIntent, setReplacementIntent] = useState<
    | { kind: "starter"; id: StarterProjectId; name: string }
    | { kind: "import"; name: string }
    | null
  >(null);

  useEffect(() => {
    if (snapshot.phase === "ready") return;
    (nameRef.current ?? dialogRef.current)?.focus();
  }, [snapshot.phase]);

  if (snapshot.phase === "ready") return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (canCancelNow) onCancel();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = focusableElementsIn(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file !== undefined) void onPickImportFile(file);
  };

  const createStarter = (id: StarterProjectId, name: string): void => {
    if (requiresBrowserReplacementConfirmation) {
      setReplacementIntent({ kind: "starter", id, name });
      return;
    }
    onCreateStarter(id, name);
  };

  const confirmImport = (name: string): void => {
    if (requiresBrowserReplacementConfirmation) {
      setReplacementIntent({ kind: "import", name });
      return;
    }
    onConfirmImport(name);
  };

  const confirmReplacement = (): void => {
    const intent = replacementIntent;
    setReplacementIntent(null);
    if (intent?.kind === "starter") onCreateStarter(intent.id, intent.name);
    else if (intent?.kind === "import") onConfirmImport(intent.name);
  };

  const sessionFailure = snapshot.phase === "session-error";
  const cloudListFailure = snapshot.phase === "cloud-list-error";
  const choiceVisible = snapshot.phase === "choosing" || snapshot.phase === "open-error";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="presentation"
      data-project-chooser="blocking"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-chooser-title"
        aria-describedby="project-chooser-description"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-200 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 id="project-chooser-title" className="text-xl font-semibold text-white">
              {snapshot.activeProject === null ? "Open a project" : "New / Open Project"}
            </h1>
            <p id="project-chooser-description" className="mt-1 text-sm text-gray-400">
              Choose where this editing session begins. Nothing underneath changes until a
              project finishes loading.
            </p>
          </div>
          {canCancelNow && (
            <button type="button" onClick={onCancel} className={BUTTON}>
              Cancel
            </button>
          )}
        </div>

        {loading !== null && (
          <p role="status" aria-live="polite" className="mt-6 rounded bg-gray-800 p-4 text-sm">
            {loading}
          </p>
        )}

        {sessionFailure && (
          <FailurePanel
            message={snapshot.error ?? "Could not check the admin session."}
            onRetry={onRetrySession}
          />
        )}

        {cloudListFailure && (
          <FailurePanel
            message={snapshot.error ?? "Could not load cloud projects."}
            onRetry={onRetryCloudList}
          />
        )}

        {cloudConflict !== null && (
          <div className="mt-5 rounded border border-amber-800 bg-amber-950/30 p-4">
            <h2 className="font-semibold text-amber-200">Choose which copy to keep</h2>
            <p className="mt-1 text-sm text-amber-100/80">
              This browser has “{cloudConflict.browserName}”, while cloud has
              “{cloudConflict.cloudName}”. No copy changes until you choose.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onResolveCloudConflict?.("cloud")}
                className={PRIMARY}
              >
                Keep cloud copy
              </button>
              <button
                type="button"
                onClick={() => onResolveCloudConflict?.("browser")}
                className={BUTTON}
              >
                Keep browser copy
              </button>
            </div>
          </div>
        )}

        {choiceVisible && (
          <>
            {snapshot.error !== null && snapshot.phase === "open-error" && (
              <p role="alert" className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {snapshot.error}
              </p>
            )}
            {inputError !== null && (
              <p role="alert" className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {inputError}
              </p>
            )}

            {replacementIntent !== null && (
              <div className="mt-4 rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-100">
                <p>
                  Replace the active browser project? Export it first if you need a portable backup.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={confirmReplacement} className={PRIMARY}>
                    Replace browser project
                  </button>
                  <button type="button" onClick={() => setReplacementIntent(null)} className={BUTTON}>
                    Keep current project
                  </button>
                </div>
              </div>
            )}

            {snapshot.browserRecovery !== null && (
              <section className="mt-5" aria-labelledby="browser-project-title">
                <h2 id="browser-project-title" className="text-sm font-semibold text-white">
                  This browser
                </h2>
                <button type="button" onClick={onContinueBrowser} className={`${BUTTON} mt-2 w-full`}>
                  <span className="block font-medium">Continue browser project</span>
                  <span className="block text-xs text-gray-400">
                    {snapshot.browserRecovery.name}
                    {snapshot.browserRecovery.assetsOnly ? " — recovered assets" : ""}
                  </span>
                </button>
              </section>
            )}

            <section className="mt-5" aria-labelledby="new-project-title">
              <h2 id="new-project-title" className="text-sm font-semibold text-white">
                Create from a starter
              </h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {starters.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    aria-pressed={starter.id === selectedStarterId}
                    disabled={!starter.available}
                    title={starter.available ? undefined : "Starter project file not installed yet."}
                    onClick={() => onSelectStarter(starter.id, starter.suggestedName)}
                    className={`${BUTTON} ${
                      starter.id === selectedStarterId ? "border-emerald-500 bg-emerald-950/30" : ""
                    }`}
                  >
                    <span className="block font-medium">{starter.label}</span>
                    {!starter.available && (
                      <span className="mt-1 block text-xs text-amber-400">Template pending</span>
                    )}
                  </button>
                ))}
              </div>

              <label className="mt-4 block text-sm text-gray-300">
                Project name
                <input
                  ref={nameRef}
                  value={projectName}
                  maxLength={160}
                  aria-invalid={!nameResult.ok}
                  aria-describedby={!nameResult.ok ? "project-name-error" : undefined}
                  onChange={(event) => onProjectNameChange(event.currentTarget.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-950 px-3 py-2 text-white"
                />
              </label>
              {!nameResult.ok && (
                <p id="project-name-error" role="alert" className="mt-1 text-xs text-red-400">
                  {nameResult.error}
                </p>
              )}
              <button
                type="button"
                disabled={!nameResult.ok || selected?.available !== true}
                onClick={() => createStarter(selectedStarterId, nameResult.name)}
                className={`${PRIMARY} mt-3`}
              >
                {snapshot.role === "admin" ? "Create cloud project" : "Create project"}
              </button>
            </section>

            <section className="mt-6 border-t border-gray-700 pt-5" aria-labelledby="import-title">
              <h2 id="import-title" className="text-sm font-semibold text-white">
                Load project file
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className={BUTTON}>
                  Choose project file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,.cardgoblin.json,application/json"
                  className="hidden"
                  onChange={handleFile}
                />
                {importedFileName !== null && (
                  <>
                    <span className="text-xs text-gray-400">{importedFileName}</span>
                    <button
                      type="button"
                      disabled={!nameResult.ok}
                      onClick={() => confirmImport(nameResult.name)}
                      className={PRIMARY}
                    >
                      {snapshot.role === "admin" ? "Create cloud project from file" : "Load project file"}
                    </button>
                  </>
                )}
              </div>
            </section>

            {snapshot.role === "admin" && (
              <section className="mt-6 border-t border-gray-700 pt-5" aria-labelledby="cloud-projects-title">
                <h2 id="cloud-projects-title" className="text-sm font-semibold text-white">
                  Cloud projects
                </h2>
                {snapshot.cloudProjects.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No cloud projects yet.</p>
                ) : (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {snapshot.cloudProjects.map((project) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          disabled={!project.readable}
                          onClick={() => onOpenCloud(project)}
                          className={`${BUTTON} w-full`}
                        >
                          <span className="block font-medium">{project.name}</span>
                          <span className="block text-xs text-gray-400">
                            {project.readable
                              ? `Updated ${project.updatedAt}`
                              : "Stored project is unreadable"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FailurePanel({ message, onRetry }: { message: string; onRetry(): void }): ReactElement {
  return (
    <div className="mt-6 rounded border border-red-900 bg-red-950/30 p-4">
      <p role="alert" className="text-sm text-red-300">
        {message}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={onRetry} className={PRIMARY}>
          Retry
        </button>
        <a href="/admin" className="text-sm text-emerald-400 hover:text-emerald-300">
          Open Admin
        </a>
      </div>
    </div>
  );
}
