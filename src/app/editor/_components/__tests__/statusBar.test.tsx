/**
 * Unified status bar (task 7, grid MINOR-2): one compact line — cards /
 * compile problems / flagged cells / excluded pristine rows / the stale
 * indicator — rendered to static markup against REAL compiles through a
 * headless editor store (same approach as the other window tests).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_PROJECT_SOURCE } from "@/lib/lang/demoProject";
import { createEditorStore, type EditorState } from "@/app/editor/_store/editorStore";
import {
  ActiveProjectChrome,
  PROJECT_RENAME_FAILED,
  default as StatusBar,
  StatusBarContent,
  runProjectRename,
} from "@/app/editor/_components/statusBar";

function renderState(state: EditorState): string {
  return renderToStaticMarkup(
    <StatusBarContent
      compile={state.compile}
      lastGood={state.lastGoodModel}
      isStale={state.isStale}
      autosaveDisabled={state.autosaveDisabled}
      projectName="Monster Deck"
      onRenameProject={() => {}}
      onNewOpenProject={() => {}}
      onExportProject={() => {}}
      onExportData={() => {}}
      onImportProject={() => {}}
    />,
  );
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

describe("StatusBarContent", () => {
  it("the connected editor bar mounts no authentication or reset controls", () => {
    const text = stripTags(
      renderToStaticMarkup(
        <StatusBar
          projectName="Monster Deck"
          onRenameProject={() => {}}
          onNewOpenProject={() => {}}
        />,
      ),
    );
    expect(text).toContain("Monster Deck");
    expect(text).toContain("New / Open Project");
    expect(text).not.toContain("Sign in");
    expect(text).not.toContain("Sign out");
    expect(text).not.toContain("Reset to demo");
  });

  it("clean seeded demo: 9 cards, zero problems/flags/exclusions, no stale indicator", () => {
    const text = stripTags(renderState(createEditorStore().getState()));
    expect(text).toContain("9 cards");
    expect(text).toContain("0 problems");
    expect(text).toContain("0 flagged cells");
    expect(text).toContain("0 pristine rows excluded");
    expect(text).not.toContain("stale");
    expect(text).not.toContain("autosave off"); // storage healthy → no indicator
  });

  it("keeps portable export while routing imports through New / Open Project", () => {
    const text = stripTags(renderState(createEditorStore().getState()));
    expect(text).toContain("Export project");
    expect(text).not.toContain("Import project");
    expect(text).toContain("New / Open Project");
    expect(text).toContain("Export Data");
    expect(text).toContain("Monster Deck");
    expect(text).toContain("New / Open Project");
    expect(text).not.toContain("Reset to demo");
    expect(text).not.toContain("Sign in");
    expect(text).not.toContain("Sign out");
  });

  it("broken compile: problems counted red, cards hold the LAST GOOD count, stale indicator on", () => {
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nCard: (((\n");
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    const text = stripTags(markup);
    expect(text).toContain("9 cards"); // keep-last-good — what the preview shows
    const problems = store.getState().compile?.diagnostics.length ?? 0;
    expect(problems).toBeGreaterThan(0); // the LIVE compile's errors count…
    expect(text).toContain(`${problems} problem`); // …is what the bar shows
    expect(markup).toContain("text-red-400");
    expect(text).toContain("show last good state"); // the stale affordance
  });

  it("warnings alone count as problems (amber), without staleness", () => {
    const store = createEditorStore();
    store.getState().setCode(DEMO_PROJECT_SOURCE + "\nEnum: Unused\n  case Only\n"); // W002
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("1 problem");
    expect(markup).toContain("text-amber-400");
    expect(stripTags(markup)).not.toContain("stale");
  });

  it("a garbage Number cell counts as ONE flagged cell (distinct cells, like the grid)", () => {
    const store = createEditorStore();
    store.getState().setCell("Monsters", 0, "health", "garbage");
    store.getState().flushCompile();
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("1 flagged cell");
    expect(markup).toContain("text-red-400");
  });

  it("an added pristine row shows in the exclusion count immediately (sync row ops)", () => {
    const store = createEditorStore();
    store.getState().addRow("Monsters");
    // No flush — row ops recompile synchronously (MAJOR-1).
    expect(stripTags(renderState(store.getState()))).toContain("1 pristine row excluded");
  });

  it("renders sanely before any compile (all-null store surface)", () => {
    const text = stripTags(
      renderToStaticMarkup(
        <StatusBarContent
          compile={null}
          lastGood={null}
          isStale={false}
          autosaveDisabled={false}
          projectName={null}
          onRenameProject={() => {}}
          onNewOpenProject={() => {}}
          onExportProject={() => {}}
          onExportData={() => {}}
          onImportProject={() => {}}
        />,
      ),
    );
    expect(text).toContain("0 cards");
    expect(text).toContain("0 problems");
  });

  it("shows the quiet 'autosave off' indicator when storage failed this session (§6.2)", () => {
    const store = createEditorStore();
    store.setState({ autosaveDisabled: true }); // as persistence.ts does
    const markup = renderState(store.getState());
    expect(stripTags(markup)).toContain("autosave off");
    expect(markup).toContain("won&#x27;t survive a reload"); // the title explains it
  });

  it("labels browser projects local-only and names cloud projects in save status", () => {
    const state = createEditorStore().getState();
    const local = renderToStaticMarkup(
      <StatusBarContent
        compile={state.compile}
        lastGood={state.lastGoodModel}
        isStale={false}
        autosaveDisabled={false}
        projectName="Local Deck"
        projectLocation="browser"
        onRenameProject={() => {}}
        onNewOpenProject={() => {}}
        onExportProject={() => {}}
        onExportData={() => {}}
        onImportProject={() => {}}
      />,
    );
    expect(stripTags(local)).toContain("Local only");

    const cloud = renderToStaticMarkup(
      <StatusBarContent
        compile={state.compile}
        lastGood={state.lastGoodModel}
        isStale={false}
        autosaveDisabled={false}
        projectName="Cloud Deck"
        projectLocation="cloud"
        cloudSync={{
          status: "signed-out",
          revision: 2,
          dirty: true,
          lastSyncedAt: null,
          error: "session ended",
        }}
        onRenameProject={() => {}}
        onNewOpenProject={() => {}}
        onExportProject={() => {}}
        onExportData={() => {}}
        onImportProject={() => {}}
      />,
    );
    expect(stripTags(cloud)).toContain("Cloud Deck · cloud save stopped");
    expect(stripTags(cloud)).toContain("Open Admin");
    expect(stripTags(cloud)).not.toContain("Sign in");
  });
});

describe("StatusBarContent — never-clip action group (adversarial review item 2)", () => {
  // Regression: the whole bar used to be ONE `overflow-hidden whitespace-
  // nowrap` line, so at ~1000px with the stale + autosave-off indicators on,
  // Project name / New/Open / Export / Import got clipped out of view along
  // with the counters. Real reflow is a
  // browser layout behavior renderToStaticMarkup can't exercise (no layout
  // engine); these pin the structural contract instead.
  it("the outer bar carries no overflow-hidden — that clipped everything, buttons included", () => {
    const markup = renderState(createEditorStore().getState());
    const barTag = markup.slice(0, markup.indexOf(">") + 1);
    expect(barTag).not.toContain("overflow-hidden");
    expect(barTag).toContain("flex-wrap");
  });

  it("only the low-priority counters are scoped to clip (min-w-0 + overflow-hidden)", () => {
    const markup = renderState(createEditorStore().getState());
    expect(markup).toContain(
      'class="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"',
    );
  });

  it("the action group (project/Assets/Export/Import) wraps instead of clipping", () => {
    const markup = renderState(createEditorStore().getState());
    expect(markup).toContain('class="ml-auto flex flex-wrap items-center gap-3"');
  });

  it("the inline rename form wraps so Save and Cancel cannot clip", () => {
    const markup = renderToStaticMarkup(
      <ActiveProjectChrome
        projectName="Monster Deck"
        onRenameProject={() => {}}
        onNewOpenProject={() => {}}
        initialEditing
      />,
    );
    expect(markup).toContain('class="flex flex-wrap items-center gap-1.5"');
    expect(stripTags(markup)).toContain("Save");
    expect(stripTags(markup)).toContain("Cancel");
  });
});

describe("ActiveProjectChrome", () => {
  const props = {
    projectName: "Monster Deck",
    onRenameProject: () => {},
    onNewOpenProject: () => {},
  };

  it("rests as the active name, Rename, and New / Open Project", () => {
    const markup = renderToStaticMarkup(<ActiveProjectChrome {...props} />);
    const text = stripTags(markup);
    expect(text).toContain("Monster Deck");
    expect(text).toContain("Rename");
    expect(text).toContain("New / Open Project");
    expect(markup).toContain('aria-label="Edit project name"');
  });

  it("has no rename affordance before a project is active", () => {
    const markup = renderToStaticMarkup(
      <ActiveProjectChrome {...props} projectName={null} />,
    );
    expect(stripTags(markup)).toContain("No active project");
    expect(stripTags(markup)).not.toContain("Rename");
    expect(stripTags(markup)).toContain("New / Open Project");
  });

  it("editing renders a labeled Save/Cancel form", () => {
    const markup = renderToStaticMarkup(<ActiveProjectChrome {...props} initialEditing />);
    const text = stripTags(markup);
    expect(markup).toContain('id="active-project-name"');
    expect(markup).toContain('value="Monster Deck"');
    expect(text).toContain("Save");
    expect(text).toContain("Cancel");
  });

  it("invalid drafts disable Save and expose the shared validation state", () => {
    const markup = renderToStaticMarkup(
      <ActiveProjectChrome
        {...props}
        initialEditing
        initialDraft=""
        initialError="Enter a project name."
      />,
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/<button type="submit" disabled=""/);
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain("Enter a project name.");
  });
});

describe("runProjectRename", () => {
  it("normalizes with the shared name contract before invoking persistence", async () => {
    const rename = vi.fn(() => undefined);
    await expect(runProjectRename("  Renamed 🃏  ", rename)).resolves.toEqual({
      ok: true,
      name: "Renamed 🃏",
      error: null,
    });
    expect(rename).toHaveBeenCalledWith("Renamed 🃏");
  });

  it("does not call persistence for an invalid name", async () => {
    const rename = vi.fn(() => undefined);
    await expect(runProjectRename("   ", rename)).resolves.toMatchObject({
      ok: false,
      error: "Enter a project name.",
    });
    expect(rename).not.toHaveBeenCalled();
  });

  it("turns persistence failure into fixed project-chrome copy", async () => {
    await expect(
      runProjectRename("Valid", async () => {
        throw new Error("localStorage leaked detail");
      }),
    ).resolves.toEqual({ ok: false, name: "Valid", error: PROJECT_RENAME_FAILED });
  });
});
