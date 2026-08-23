import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverStarterFileNames,
  renderStarterRegistry,
} from "../generate-starter-projects.mjs";

describe("starter project registry generator", () => {
  it("renders byte-identically regardless of discovery order", () => {
    const ordered = [
      "poker-deck.cardgoblin.json",
      "tcg.cardgoblin.json",
      "party-game.cardgoblin.json",
    ];
    expect(renderStarterRegistry([...ordered].reverse())).toBe(renderStarterRegistry(ordered));
  });

  it("emits one literal lazy import per present source and no eager JSON import", () => {
    const output = renderStarterRegistry(["tcg.cardgoblin.json"]);
    expect(output).toContain('import("../../../../template_projects/tcg.cardgoblin.json")');
    expect(output).not.toMatch(/^import .*template_projects/m);
    expect(output.match(/template_projects\/tcg\.cardgoblin\.json/g)).toHaveLength(1);
    expect(output).not.toContain('import("../../../../template_projects/poker-deck.cardgoblin.json")');
  });

  it("rejects duplicates and unexpected project filenames", () => {
    expect(() => renderStarterRegistry(["tcg.cardgoblin.json", "tcg.cardgoblin.json"]))
      .toThrow(/Duplicate starter project source/);
    expect(() => renderStarterRegistry(["typo.cardgoblin.json"]))
      .toThrow(/Unexpected starter project file/);
  });

  it("keeps the committed generated output fresh", async () => {
    const root = process.cwd();
    const present = await discoverStarterFileNames(path.join(root, "template_projects"));
    const actual = await readFile(
      path.join(root, "src/app/editor/_generated/starterProjects.generated.ts"),
      "utf8",
    );
    expect(actual).toBe(renderStarterRegistry(present));
  });
});
