/**
 * Pure project-lifecycle authority (DESIGN ◆53 / §7.8).
 *
 * The editor used to let three independent mount effects decide what project
 * was visible: localStorage restore, IndexedDB attachment, then the fixed
 * cloud mirror. Multi-project startup needs one authority in front of all
 * three. This controller owns only the small coordination state; project
 * bytes and editor compilation stay in their existing stores.
 *
 * Every async transition carries an operation number. A late session response,
 * cloud-list page, import, or project load is ignored after Retry/switch starts
 * a newer operation. That is the client-state half of the immutable-project-ID
 * rule; transport requests must additionally capture their project ID in their
 * URL/key and never read a mutable "current ID" after starting.
 */

import {
  PROJECT_NAME_CONTROL_CHARACTERS,
  PROJECT_NAME_MAX_CODE_POINTS,
  PROJECT_NAME_REQUIRED,
  PROJECT_NAME_TOO_LONG,
  normalizeProjectName,
  type ProjectNameResult,
} from "@/lib/projects/projectMetadata";

export {
  PROJECT_NAME_CONTROL_CHARACTERS,
  PROJECT_NAME_MAX_CODE_POINTS,
  PROJECT_NAME_REQUIRED,
  PROJECT_NAME_TOO_LONG,
  normalizeProjectName,
  type ProjectNameResult,
};

export type ProjectRole = "unknown" | "anonymous" | "admin";
export type ProjectLocation = "browser" | "cloud";

export interface ActiveProject {
  location: ProjectLocation;
  /** Immutable storage identity. Display names never become object keys. */
  id: string;
  name: string;
  /** Null for browser-only projects; authoritative cloud revision otherwise. */
  revision: number | null;
}

export interface BrowserRecoverySummary {
  id: string;
  name: string;
  /** True when only legacy assets survived and recovery will use an empty seed. */
  assetsOnly: boolean;
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** A damaged manifest stays visible but cannot be opened. */
  readable: boolean;
}

export type ProjectLifecyclePhase =
  | "checking-session"
  | "session-error"
  | "loading-cloud-projects"
  | "cloud-list-error"
  | "choosing"
  | "opening"
  | "creating-cloud-project"
  | "open-error"
  | "ready";

export interface ProjectLifecycleSnapshot {
  phase: ProjectLifecyclePhase;
  role: ProjectRole;
  activeProject: ActiveProject | null;
  browserRecovery: BrowserRecoverySummary | null;
  cloudProjects: readonly CloudProjectSummary[];
  /** User-facing, already-safe copy. Never place raw provider errors here. */
  error: string | null;
  /** The only async operation allowed to publish into this snapshot. */
  operation: number;
}

export interface ProjectLifecycleController {
  getSnapshot(): ProjectLifecycleSnapshot;
  subscribe(listener: () => void): () => void;

  beginSessionCheck(): number;
  resolveAnonymous(
    operation: number,
    browserRecovery: BrowserRecoverySummary | null,
  ): void;
  resolveAdmin(
    operation: number,
    browserRecovery: BrowserRecoverySummary | null,
  ): void;
  failSessionCheck(operation: number, message: string): void;

  beginCloudList(): number | null;
  resolveCloudList(operation: number, projects: readonly CloudProjectSummary[]): void;
  failCloudList(operation: number, message: string): void;

  beginOpen(kind: "open" | "create-cloud"): number;
  completeOpen(operation: number, project: ActiveProject): void;
  failOpen(operation: number, message: string): void;

  /** Reopen the chooser over a safe active project. */
  openChooser(): void;
  /** Only succeeds for the post-start chooser (active project already exists). */
  cancelChooser(): boolean;
  /** Rename the in-memory metadata snapshot after persistence accepts it. */
  renameActiveProject(name: string): ProjectNameResult;
  /** Publish a revision only after a revision-checked cloud save succeeds. */
  setActiveCloudRevision(revision: number): boolean;
}

export function initialProjectLifecycleSnapshot(): ProjectLifecycleSnapshot {
  return {
    phase: "checking-session",
    role: "unknown",
    activeProject: null,
    browserRecovery: null,
    cloudProjects: [],
    error: null,
    operation: 0,
  };
}

function sameProject(a: ActiveProject, b: ActiveProject): boolean {
  return (
    a.location === b.location &&
    a.id === b.id &&
    a.name === b.name &&
    a.revision === b.revision
  );
}

function cloudSummaryOrder(a: CloudProjectSummary, b: CloudProjectSummary): number {
  // ISO timestamps compare lexically. The immutable ID is the tie-breaker so
  // pagination or R2 enumeration order cannot reshuffle equal timestamps.
  const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
  return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
}

export function createProjectLifecycleController(
  seed: ProjectLifecycleSnapshot = initialProjectLifecycleSnapshot(),
): ProjectLifecycleController {
  let snapshot = seed;
  const listeners = new Set<() => void>();

  const publish = (next: ProjectLifecycleSnapshot): void => {
    if (Object.is(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const begin = (phase: ProjectLifecyclePhase): number => {
    const operation = snapshot.operation + 1;
    publish({ ...snapshot, phase, error: null, operation });
    return operation;
  };

  const current = (operation: number): boolean => snapshot.operation === operation;

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    beginSessionCheck: () => {
      const operation = snapshot.operation + 1;
      publish({
        ...snapshot,
        phase: "checking-session",
        role: "unknown",
        activeProject: null,
        browserRecovery: null,
        cloudProjects: [],
        error: null,
        operation,
      });
      return operation;
    },

    resolveAnonymous: (operation, browserRecovery) => {
      if (!current(operation) || snapshot.phase !== "checking-session") return;
      publish({
        ...snapshot,
        phase: "choosing",
        role: "anonymous",
        browserRecovery,
        cloudProjects: [],
        error: null,
      });
    },

    resolveAdmin: (operation, browserRecovery) => {
      if (!current(operation) || snapshot.phase !== "checking-session") return;
      publish({
        ...snapshot,
        phase: "loading-cloud-projects",
        role: "admin",
        browserRecovery,
        cloudProjects: [],
        error: null,
      });
    },

    failSessionCheck: (operation, message) => {
      if (!current(operation) || snapshot.phase !== "checking-session") return;
      publish({ ...snapshot, phase: "session-error", error: message });
    },

    beginCloudList: () => {
      if (snapshot.role !== "admin") return null;
      return begin("loading-cloud-projects");
    },

    resolveCloudList: (operation, projects) => {
      if (!current(operation) || snapshot.phase !== "loading-cloud-projects") return;
      publish({
        ...snapshot,
        phase: "choosing",
        cloudProjects: [...projects].sort(cloudSummaryOrder),
        error: null,
      });
    },

    failCloudList: (operation, message) => {
      if (!current(operation) || snapshot.phase !== "loading-cloud-projects") return;
      publish({ ...snapshot, phase: "cloud-list-error", error: message });
    },

    beginOpen: (kind) => begin(kind === "open" ? "opening" : "creating-cloud-project"),

    completeOpen: (operation, project) => {
      if (
        !current(operation) ||
        (snapshot.phase !== "opening" && snapshot.phase !== "creating-cloud-project")
      ) {
        return;
      }
      const activeProject =
        snapshot.activeProject && sameProject(snapshot.activeProject, project)
          ? snapshot.activeProject
          : project;
      const browserRecovery = project.location === "browser"
        ? { id: project.id, name: project.name, assetsOnly: false }
        : snapshot.browserRecovery;
      publish({ ...snapshot, phase: "ready", activeProject, browserRecovery, error: null });
    },

    failOpen: (operation, message) => {
      if (
        !current(operation) ||
        (snapshot.phase !== "opening" && snapshot.phase !== "creating-cloud-project")
      ) {
        return;
      }
      publish({ ...snapshot, phase: "open-error", error: message });
    },

    openChooser: () => {
      if (snapshot.phase !== "ready" || snapshot.activeProject === null) return;
      begin("choosing");
    },

    cancelChooser: () => {
      if (snapshot.activeProject === null || snapshot.phase === "ready") return false;
      begin("ready");
      return true;
    },

    renameActiveProject: (input) => {
      const result = normalizeProjectName(input);
      if (!result.ok || snapshot.activeProject === null) return result;
      if (snapshot.activeProject.name === result.name) return result;
      const browserRecovery = snapshot.activeProject.location === "browser"
        ? { id: snapshot.activeProject.id, name: result.name, assetsOnly: false }
        : snapshot.browserRecovery;
      publish({
        ...snapshot,
        activeProject: { ...snapshot.activeProject, name: result.name },
        browserRecovery,
      });
      return result;
    },

    setActiveCloudRevision: (revision) => {
      const active = snapshot.activeProject;
      if (
        active?.location !== "cloud" ||
        !Number.isInteger(revision) ||
        revision < 1 ||
        revision < (active.revision ?? 1)
      ) {
        return false;
      }
      if (active.revision === revision) return true;
      publish({ ...snapshot, activeProject: { ...active, revision } });
      return true;
    },
  };
}

/** Stable singleton for React integration. It performs no I/O at import time. */
export const projectLifecycle = createProjectLifecycleController();
