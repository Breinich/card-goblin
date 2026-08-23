import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_NAME_CONTROL_CHARACTERS,
  PROJECT_NAME_REQUIRED,
  PROJECT_NAME_TOO_LONG,
  createProjectLifecycleController,
  normalizeProjectName,
  type ActiveProject,
} from "@/app/editor/_store/projectLifecycle";

const browserProject: ActiveProject = {
  location: "browser",
  id: "browser-default",
  name: "My Game",
  revision: null,
};

describe("normalizeProjectName", () => {
  it("trims, normalizes NFC, and accepts Unicode display names", () => {
    expect(normalizeProjectName("  Cafe\u0301 🃏  ")).toEqual({
      ok: true,
      name: "Café 🃏",
      error: null,
    });
  });

  it("rejects empty, control-character, and over-80-code-point names", () => {
    expect(normalizeProjectName("  ").error).toBe(PROJECT_NAME_REQUIRED);
    expect(normalizeProjectName("bad\nname").error).toBe(PROJECT_NAME_CONTROL_CHARACTERS);
    expect(normalizeProjectName("🃏".repeat(81)).error).toBe(PROJECT_NAME_TOO_LONG);
    expect(normalizeProjectName("🃏".repeat(80)).ok).toBe(true);
  });
});

describe("project lifecycle controller", () => {
  it("starts blocked at session detection and only an explicit result reaches choosing", () => {
    const lifecycle = createProjectLifecycleController();
    expect(lifecycle.getSnapshot()).toMatchObject({
      phase: "checking-session",
      role: "unknown",
      activeProject: null,
    });

    const op = lifecycle.beginSessionCheck();
    lifecycle.failSessionCheck(op, "Could not check session.");
    expect(lifecycle.getSnapshot()).toMatchObject({
      phase: "session-error",
      role: "unknown",
      error: "Could not check session.",
    });

    const retry = lifecycle.beginSessionCheck();
    lifecycle.resolveAnonymous(retry, null);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "choosing", role: "anonymous" });
  });

  it("makes admin project-list loading explicit and sorts deterministically", () => {
    const lifecycle = createProjectLifecycleController();
    const session = lifecycle.beginSessionCheck();
    lifecycle.resolveAdmin(session, { id: "legacy", name: "Browser Project", assetsOnly: false });
    expect(lifecycle.getSnapshot()).toMatchObject({
      phase: "loading-cloud-projects",
      role: "admin",
    });

    const list = lifecycle.beginCloudList();
    if (list === null) throw new Error("admin list did not start");
    lifecycle.resolveCloudList(list, [
      {
        id: "b",
        name: "B",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        readable: true,
      },
      {
        id: "a",
        name: "A",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        readable: true,
      },
    ]);
    expect(lifecycle.getSnapshot().cloudProjects.map((project) => project.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("ignores stale async completions after Retry starts a newer operation", () => {
    const lifecycle = createProjectLifecycleController();
    const stale = lifecycle.beginSessionCheck();
    const current = lifecycle.beginSessionCheck();
    lifecycle.resolveAdmin(stale, null);
    expect(lifecycle.getSnapshot().role).toBe("unknown");
    lifecycle.resolveAnonymous(current, null);
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "choosing", role: "anonymous" });
  });

  it("does not let a stale project load replace the winning project", () => {
    const lifecycle = createProjectLifecycleController();
    const session = lifecycle.beginSessionCheck();
    lifecycle.resolveAnonymous(session, null);
    const stale = lifecycle.beginOpen("open");
    const current = lifecycle.beginOpen("open");
    lifecycle.completeOpen(stale, { ...browserProject, name: "Stale" });
    expect(lifecycle.getSnapshot().activeProject).toBeNull();
    lifecycle.completeOpen(current, browserProject);
    expect(lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: browserProject,
    });
  });

  it("allows cancel only when the chooser covers an existing active project", () => {
    const lifecycle = createProjectLifecycleController();
    expect(lifecycle.cancelChooser()).toBe(false);

    const session = lifecycle.beginSessionCheck();
    lifecycle.resolveAnonymous(session, null);
    const open = lifecycle.beginOpen("open");
    lifecycle.completeOpen(open, browserProject);
    lifecycle.openChooser();
    expect(lifecycle.getSnapshot().phase).toBe("choosing");
    expect(lifecycle.cancelChooser()).toBe(true);
    expect(lifecycle.getSnapshot()).toMatchObject({
      phase: "ready",
      activeProject: browserProject,
    });
  });

  it("renames only a live active project and publishes once", () => {
    const lifecycle = createProjectLifecycleController();
    const listener = vi.fn();
    lifecycle.subscribe(listener);
    expect(lifecycle.renameActiveProject("No project").ok).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    const session = lifecycle.beginSessionCheck();
    lifecycle.resolveAnonymous(session, null);
    const open = lifecycle.beginOpen("open");
    lifecycle.completeOpen(open, browserProject);
    listener.mockClear();

    expect(lifecycle.renameActiveProject("  Renamed 🃏  ")).toEqual({
      ok: true,
      name: "Renamed 🃏",
      error: null,
    });
    expect(lifecycle.getSnapshot().activeProject?.name).toBe("Renamed 🃏");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes only monotonic cloud revisions", () => {
    const lifecycle = createProjectLifecycleController();
    const session = lifecycle.beginSessionCheck();
    lifecycle.resolveAdmin(session, null);
    const open = lifecycle.beginOpen("open");
    lifecycle.completeOpen(open, {
      location: "cloud",
      id: "123e4567-e89b-42d3-a456-426614174000",
      name: "Cloud deck",
      revision: 3,
    });

    expect(lifecycle.setActiveCloudRevision(2)).toBe(false);
    expect(lifecycle.setActiveCloudRevision(4)).toBe(true);
    expect(lifecycle.getSnapshot().activeProject?.revision).toBe(4);
  });
});
