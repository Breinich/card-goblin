import { describe, expect, it } from "vitest";
import {
  getStarterProject,
  STARTER_PROJECTS,
  type StarterProjectId,
} from "../starterProjects";

describe("starter project registry", () => {
  it("has the fixed deterministic chooser order and metadata", () => {
    expect(STARTER_PROJECTS.map(({ id, label, suggestedName, sourceFile }) => ({
      id,
      label,
      suggestedName,
      sourceFile,
    }))).toEqual([
      { id: "blank", label: "Blank", suggestedName: "Untitled Project", sourceFile: null },
      {
        id: "poker-deck",
        label: "Poker Deck",
        suggestedName: "Poker Deck",
        sourceFile: "poker-deck.cardgoblin.json",
      },
      { id: "tcg", label: "TCG", suggestedName: "TCG", sourceFile: "tcg.cardgoblin.json" },
      {
        id: "party-game",
        label: "Party Game",
        suggestedName: "Party Game",
        sourceFile: "party-game.cardgoblin.json",
      },
    ]);
  });

  it("keeps absent owner-authored files explicitly unavailable", () => {
    expect(STARTER_PROJECTS.slice(1).map(({ available, load }) => ({ available, load }))).toEqual([
      { available: false, load: null },
      { available: false, load: null },
      { available: false, load: null },
    ]);
  });

  it("loads a fresh, deeply independent Blank project on every creation", async () => {
    const blank = getStarterProject("blank");
    expect(blank.available).toBe(true);
    if (!blank.available) throw new Error("Blank must always be available");

    const first = await blank.load();
    const second = await blank.load();
    expect(first).toEqual({ seed: { code: "", sheets: {} }, assets: [] });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.seed).not.toBe(first.seed);
    expect(second.seed.sheets).not.toBe(first.seed.sheets);
    expect(second.assets).not.toBe(first.assets);
  });

  it("resolves every fixed ID exactly once", () => {
    const ids: StarterProjectId[] = ["blank", "poker-deck", "tcg", "party-game"];
    for (const id of ids) expect(getStarterProject(id).id).toBe(id);
    expect(new Set(STARTER_PROJECTS.map((starter) => starter.id)).size).toBe(ids.length);
  });
});
