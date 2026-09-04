import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectChooser,
  canCancelProjectChooser,
  type ProjectChooserProps,
} from "@/app/editor/_components/projectChooser";
import { STARTER_PROJECTS } from "@/app/editor/_lib/starterProjects";
import {
  initialProjectLifecycleSnapshot,
  type ProjectLifecycleSnapshot,
} from "@/app/editor/_store/projectLifecycle";

function choosing(overrides: Partial<ProjectLifecycleSnapshot> = {}): ProjectLifecycleSnapshot {
  return {
    ...initialProjectLifecycleSnapshot(),
    phase: "choosing",
    role: "anonymous",
    ...overrides,
  };
}

function props(snapshot: ProjectLifecycleSnapshot): ProjectChooserProps {
  return {
    snapshot,
    starters: STARTER_PROJECTS,
    selectedStarterId: "blank",
    projectName: "Untitled Project",
    importedFileName: null,
    onSelectStarter: vi.fn(),
    onProjectNameChange: vi.fn(),
    onCreateStarter: vi.fn(),
    onPickImportFile: vi.fn(),
    onConfirmImport: vi.fn(),
    onContinueBrowser: vi.fn(),
    onOpenCloud: vi.fn(),
    onRetrySession: vi.fn(),
    onRetryCloudList: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("ProjectChooser", () => {
  it("renders a non-dismissible initial anonymous chooser with required options", () => {
    const html = renderToStaticMarkup(<ProjectChooser {...props(choosing())} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Blank");
    expect(html).toContain("Poker Deck");
    expect(html).toContain("TCG");
    expect(html).toContain("Party Game");
    expect(html).toContain("Choose project file");
    expect(html).not.toContain(">Cancel<");
    expect(html).not.toContain("Cloud projects");
    expect(html).not.toContain("Sign in");
  });

  it("shows browser recovery only when discovered", () => {
    const without = renderToStaticMarkup(<ProjectChooser {...props(choosing())} />);
    expect(without).not.toContain("Continue browser project");
    const withRecovery = renderToStaticMarkup(
      <ProjectChooser
        {...props(
          choosing({
            browserRecovery: { id: "browser-legacy", name: "Browser Project", assetsOnly: false },
          }),
        )}
      />,
    );
    expect(withRecovery).toContain("Continue browser project");
    expect(withRecovery).toContain("Browser Project");
  });

  it("adds cloud projects only for admin and disables unreadable entries", () => {
    const html = renderToStaticMarkup(
      <ProjectChooser
        {...props(
          choosing({
            role: "admin",
            cloudProjects: [
              {
                id: "default",
                name: "Legacy Cloud Project",
                createdAt: "1970-01-01T00:00:00.000Z",
                updatedAt: "1970-01-01T00:00:00.000Z",
                readable: true,
              },
              {
                id: "broken",
                name: "Unreadable project",
                createdAt: "1970-01-01T00:00:00.000Z",
                updatedAt: "1970-01-01T00:00:00.000Z",
                readable: false,
              },
            ],
          }),
        )}
      />,
    );
    expect(html).toContain("Cloud projects");
    expect(html).toContain("Legacy Cloud Project");
    expect(html).toContain("Stored project is unreadable");
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*Unreadable project/);
  });

  it("shows fixed Retry/Admin recovery for an indeterminate session", () => {
    const html = renderToStaticMarkup(
      <ProjectChooser
        {...props({
          ...initialProjectLifecycleSnapshot(),
          phase: "session-error",
          error: "Could not check session.",
        })}
      />,
    );
    expect(html).toContain("Could not check session.");
    expect(html).toContain(">Retry<");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("Create project");
  });

  it("allows Cancel only when an active project exists beneath the chooser", () => {
    const initial = choosing();
    expect(canCancelProjectChooser(initial)).toBe(false);
    const postStart = choosing({
      activeProject: {
        location: "browser",
        id: "browser-default",
        name: "Game",
        revision: null,
      },
    });
    expect(canCancelProjectChooser(postStart)).toBe(true);
    expect(renderToStaticMarkup(<ProjectChooser {...props(postStart)} />)).toContain(">Cancel<");

    const committing = { ...postStart, phase: "opening" as const };
    const committingHtml = renderToStaticMarkup(<ProjectChooser {...props(committing)} />);
    expect(committingHtml).toContain("Opening project…");
    expect(committingHtml).not.toContain(">Cancel<");
  });

});
