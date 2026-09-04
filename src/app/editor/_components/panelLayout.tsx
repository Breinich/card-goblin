"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ProjectChooser } from "@/app/editor/_components/projectChooser";
import StatusBar from "@/app/editor/_components/statusBar";
import WindowCode from "@/app/editor/_components/windowCode";
import WindowPreview from "@/app/editor/_components/windowPreview";
import WindowSpreadsheet from "@/app/editor/_components/windowSpreadsheet";
import {
  parseImportedProjectFile,
  type ParsedProjectFile,
} from "@/app/editor/_lib/projectFileFormat";
import { sha256Hex } from "@/app/editor/_lib/namedCloudClient";
import { registerFont } from "@/app/editor/_lib/fontRegistry";
import {
  STARTER_PROJECTS,
  type StarterProjectId,
} from "@/app/editor/_lib/starterProjects";
import {
  createBrowserProjectBootstrap,
  type ProjectBootstrapController,
  type ProjectBootstrapSnapshot,
} from "@/app/editor/_store/projectBootstrap";
import { projectLifecycle } from "@/app/editor/_store/projectLifecycle";
import { normalizeProjectName } from "@/lib/projects/projectMetadata";

const EMPTY_BOOTSTRAP_SNAPSHOT: ProjectBootstrapSnapshot = {
  conflict: null,
  cloudSync: null,
};
const subscribeNothing = (): (() => void) => () => {};

function suggestedImportName(file: File, parsed: ParsedProjectFile): string {
  if (parsed.name !== undefined) return parsed.name;
  const base = file.name
    .replace(/\.cardgoblin\.json$/i, "")
    .replace(/\.json$/i, "")
    .trim();
  const normalized = normalizeProjectName(base);
  return normalized.ok ? normalized.name : "Imported Project";
}

export default function PanelLayout() {
  const lifecycle = useSyncExternalStore(
    projectLifecycle.subscribe,
    projectLifecycle.getSnapshot,
    projectLifecycle.getSnapshot,
  );
  const [bootstrap, setBootstrap] = useState<ProjectBootstrapController | null>(null);
  const [selectedStarterId, setSelectedStarterId] = useState<StarterProjectId>("blank");
  const [projectName, setProjectName] = useState("Untitled Project");
  const [imported, setImported] = useState<{
    fileName: string;
    sourceKey: string;
    project: ParsedProjectFile;
  } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const subscribeBootstrap = useCallback(
    (listener: () => void) => bootstrap?.subscribe(listener) ?? subscribeNothing(),
    [bootstrap],
  );
  const getBootstrapSnapshot = useCallback(
    () => bootstrap?.getSnapshot() ?? EMPTY_BOOTSTRAP_SNAPSHOT,
    [bootstrap],
  );
  const bootstrapSnapshot = useSyncExternalStore(
    subscribeBootstrap,
    getBootstrapSnapshot,
    () => EMPTY_BOOTSTRAP_SNAPSHOT,
  );

  // The old three independent init effects are intentionally gone. This one
  // authority discovers only metadata first; it binds persistence and assets
  // after a chooser operation has been staged and verified.
  useEffect(() => {
    const controller = createBrowserProjectBootstrap();
    setBootstrap(controller);
    void controller.start();
    return () => controller.dispose();
  }, []);

  useEffect(() => {
    if (lifecycle.phase !== "ready") return;
    setImported(null);
    setInputError(null);
  }, [lifecycle.phase]);

  const pickImportFile = async (file: File): Promise<void> => {
    setInputError(null);
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setImported(null);
      setInputError("The project file could not be read.");
      return;
    }
    const parsed = parseImportedProjectFile(raw);
    if ("error" in parsed) {
      setImported(null);
      setInputError(parsed.error);
      return;
    }
    let sourceKey: string;
    try {
      sourceKey = await sha256Hex(new TextEncoder().encode(raw));
    } catch {
      setImported(null);
      setInputError("The project file could not be fingerprinted safely. Please retry.");
      return;
    }
    setImported({
      fileName: file.name,
      sourceKey,
      project: parsed,
    });
    setProjectName(suggestedImportName(file, parsed));
  };

  const showEditor = lifecycle.activeProject !== null;
  const blocked = lifecycle.phase !== "ready";
  const requiresBrowserReplacement =
    lifecycle.role === "anonymous" &&
    (lifecycle.browserRecovery !== null || lifecycle.activeProject?.location === "browser");

  return (
    <div className="h-screen bg-gray-900 text-white">
      {showEditor ? (
        <div
          key={`${lifecycle.activeProject?.location}:${lifecycle.activeProject?.id}`}
          className="flex h-full flex-col"
          aria-hidden={blocked || undefined}
          inert={blocked || undefined}
        >
          <div className="min-h-0 flex-1">
            <PanelGroup direction="vertical" className="h-full w-full">
              <Panel className="flex-grow" defaultSize={70}>
                <PanelGroup direction="horizontal">
                  <Panel className="bg-gray-800 border-r border-gray-700" defaultSize={50}>
                    <WindowCode />
                  </Panel>
                  <PanelResizeHandle className="w-2 bg-gray-600 hover:bg-gray-500 cursor-col-resize" />
                  <Panel
                    className="flex justify-center items-center bg-gray-900"
                    defaultSize={50}
                  >
                    <WindowPreview />
                  </Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className="h-2 bg-gray-600 hover:bg-gray-500 cursor-row-resize" />
              <Panel defaultSize={30}>
                <WindowSpreadsheet />
              </Panel>
            </PanelGroup>
          </div>
          <StatusBar
            projectName={lifecycle.activeProject?.name ?? null}
            onRenameProject={(name) => bootstrap?.renameActiveProject(name)}
            onNewOpenProject={() => bootstrap?.openChooser()}
            cloudSync={bootstrapSnapshot.cloudSync}
            projectLocation={lifecycle.activeProject?.location ?? null}
            onRetryCloudSync={() => void bootstrap?.retryCloudSync()}
          />
        </div>
      ) : (
        <div aria-hidden="true" className="h-full bg-gray-900" data-empty-editor-shell />
      )}

      <ProjectChooser
        snapshot={lifecycle}
        starters={STARTER_PROJECTS}
        selectedStarterId={selectedStarterId}
        projectName={projectName}
        importedFileName={imported?.fileName ?? null}
        inputError={inputError}
        requiresBrowserReplacementConfirmation={requiresBrowserReplacement}
        cloudConflict={bootstrapSnapshot.conflict}
        onResolveCloudConflict={(choice) => void bootstrap?.resolveCloudConflict(choice)}
        onSelectStarter={(id, suggestedName) => {
          setSelectedStarterId(id);
          setProjectName(suggestedName);
          setInputError(null);
        }}
        onProjectNameChange={setProjectName}
        onCreateStarter={(id, name) => void bootstrap?.createFromStarter(id, name)}
        onPickImportFile={pickImportFile}
        onConfirmImport={(name) => {
          if (imported !== null) {
            for (const font of imported.project.fonts ?? []) {
              try { registerFont(font); } catch { /* malformed optional metadata is ignored */ }
            }
            void bootstrap?.openImportedProject(imported.project, name, imported.sourceKey);
          }
        }}
        onContinueBrowser={() => void bootstrap?.continueBrowserProject()}
        onOpenCloud={(project) => void bootstrap?.openCloudProject(project)}
        onRetrySession={() => void bootstrap?.retrySession()}
        onRetryCloudList={() => void bootstrap?.retryCloudList()}
        onCancel={() => bootstrap?.cancelChooser()}
      />
    </div>
  );
}
