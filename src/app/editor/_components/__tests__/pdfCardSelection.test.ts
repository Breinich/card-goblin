import { describe, expect, it } from "vitest";
import type { CardInstance, Deck, RenderModel } from "@/lib/lang";
import {
  allProjectCardIndices,
  deselectProjectCards,
  filterRenderModelBySelection,
  formatProjectCardNumberRanges,
  parseProjectCardNumbers,
  printableProjectCardIndices,
  projectCardCount,
  selectOnlyProjectCards,
} from "../pdfCardSelection";

function card(projectCardIndex: number, unavailable = false): CardInstance {
  return {
    front: [],
    back: [],
    exportData: {},
    meta: {
      rowIndex: projectCardIndex,
      loopBindings: {},
      copyIndex: 0,
      deckCardIndex: projectCardIndex,
      projectCardIndex,
    },
    contentHash: `card-${projectCardIndex}`,
    ...(unavailable ? { error: { diagnostics: [] } } : {}),
  };
}

function deck(cardName: string, cards: readonly CardInstance[]): Deck {
  return {
    cardName,
    sheetName: `${cardName} data`,
    widthMm: 63.5,
    heightMm: 88.9,
    xUnits: 10,
    yUnits: 14,
    cards,
  };
}

function fixtureModel(): RenderModel {
  return {
    decks: [
      deck("Alpha", [card(0), card(1, true), card(2)]),
      deck("Empty", []),
      deck("Beta", [card(3), card(4)]),
    ],
  };
}

describe("parseProjectCardNumbers", () => {
  it("parses one-based numbers and inclusive ranges into zero-based indices", () => {
    const result = parseProjectCardNumbers("1-3, 6, 8 - 10", 10);

    expect(result.errors).toEqual([]);
    expect([...result.indices]).toEqual([0, 1, 2, 5, 7, 8, 9]);
  });

  it("deduplicates repeated and overlapping entries", () => {
    const result = parseProjectCardNumbers("3, 1-4, 3-5, 01", 5);

    expect(result.errors).toEqual([]);
    expect([...result.indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("reports an empty expression", () => {
    expect(parseProjectCardNumbers("  ", 100)).toEqual({
      indices: new Set(),
      errors: [
        {
          code: "empty-input",
          itemIndex: 0,
          token: "",
          startOffset: 0,
          endOffset: 2,
          message: "Enter a card number or range, such as 1-6.",
        },
      ],
    });
  });

  it("reports every malformed or empty item with its source position", () => {
    const result = parseProjectCardNumbers("1, , fish, 4-", 10);

    expect(result.indices).toEqual(new Set([0]));
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "empty-item",
        itemIndex: 1,
        token: "",
        startOffset: 3,
        endOffset: 3,
      }),
      expect.objectContaining({
        code: "malformed-item",
        itemIndex: 2,
        token: "fish",
        startOffset: 5,
        endOffset: 9,
      }),
      expect.objectContaining({
        code: "malformed-item",
        itemIndex: 3,
        token: "4-",
        startOffset: 11,
        endOffset: 13,
      }),
    ]);
  });

  it("rejects descending ranges explicitly", () => {
    const result = parseProjectCardNumbers("6-2", 10);

    expect(result.indices.size).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "descending-range",
        token: "6-2",
        message: "“6-2” is backwards. A range must start at or before its end.",
      }),
    ]);
  });

  it("identifies the invalid endpoint of an out-of-range number or range", () => {
    const zero = parseProjectCardNumbers("0", 128);
    const highRange = parseProjectCardNumbers("126-130", 128);
    const enormous = parseProjectCardNumbers("999999999999999999999", 128);

    expect(zero.errors[0]).toMatchObject({
      code: "out-of-range",
      message: "Card 0 is out of range. Enter a number from 1 to 128.",
    });
    expect(highRange.errors[0]).toMatchObject({
      code: "out-of-range",
      message: "Card 130 is out of range. Enter a number from 1 to 128.",
    });
    expect(enormous.errors[0]).toMatchObject({
      code: "out-of-range",
      message:
        "Card 999999999999999999999 is out of range. Enter a number from 1 to 128.",
    });
    expect(highRange.indices.size).toBe(0);
  });

  it("handles a model with no generated cards without expanding ranges", () => {
    expect(parseProjectCardNumbers("1-999999999999999999999", 0).errors[0]).toMatchObject({
      code: "out-of-range",
      message: "No generated cards are available.",
    });
  });

  it("rejects an invalid card count contract", () => {
    expect(() => parseProjectCardNumbers("1", -1)).toThrow(RangeError);
    expect(() => parseProjectCardNumbers("1", 1.5)).toThrow(RangeError);
  });
});

describe("project-card selection operations", () => {
  it("compacts unavailable-card announcements into capped one-based ranges", () => {
    expect(formatProjectCardNumberRanges([0, 1, 2, 4, 7, 8])).toBe(
      "#1–#3, #5, #8–#9",
    );
    expect(formatProjectCardNumberRanges([0, 2, 4, 6], 2)).toBe(
      "#1, #3, and 2 more cards",
    );
    expect(formatProjectCardNumberRanges([])).toBe("");
    expect(() => formatProjectCardNumberRanges([-1])).toThrow(RangeError);
  });

  it("creates a new select-only Set and deduplicates its input", () => {
    const source = new Set([2, 4]);
    const selected = selectOnlyProjectCards(source);

    expect(selected).toEqual(new Set([2, 4]));
    expect(selected).not.toBe(source);
    expect(source).toEqual(new Set([2, 4]));
  });

  it("deselects immutably and ignores indices that were not selected", () => {
    const original = new Set([0, 1, 2, 4]);
    const toRemove = new Set([1, 3]);
    const selected = deselectProjectCards(original, toRemove);

    expect(selected).toEqual(new Set([0, 2, 4]));
    expect(original).toEqual(new Set([0, 1, 2, 4]));
    expect(toRemove).toEqual(new Set([1, 3]));
  });

  it("enumerates all and printable indices without renumbering placeholders", () => {
    const model = fixtureModel();

    expect(projectCardCount(model)).toBe(5);
    expect(allProjectCardIndices(model)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(printableProjectCardIndices(model)).toEqual(new Set([0, 2, 3, 4]));
  });
});

describe("filterRenderModelBySelection", () => {
  it("preserves deck/card order and original project indices and omits empty decks", () => {
    const model = fixtureModel();
    const filtered = filterRenderModelBySelection(model, new Set([4, 0, 2]));

    expect(filtered.decks.map((item) => item.cardName)).toEqual(["Alpha", "Beta"]);
    expect(
      filtered.decks.map((item) => item.cards.map((item) => item.meta.projectCardIndex)),
    ).toEqual([[0, 2], [4]]);
  });

  it("does not mutate or reuse model, deck, or cards-array containers", () => {
    const model = fixtureModel();
    const originalDecks = model.decks;
    const originalCards = model.decks.map((item) => item.cards);
    const originalIndices = model.decks.map((item) =>
      item.cards.map((item) => item.meta.projectCardIndex),
    );

    const filtered = filterRenderModelBySelection(model, new Set([0, 2, 3, 4]));

    expect(filtered).not.toBe(model);
    expect(filtered.decks).not.toBe(originalDecks);
    expect(filtered.decks[0]).not.toBe(model.decks[0]);
    expect(filtered.decks[0].cards).not.toBe(originalCards[0]);
    expect(filtered.decks[0].cards[0]).toBe(model.decks[0].cards[0]);
    expect(
      model.decks.map((item) => item.cards.map((item) => item.meta.projectCardIndex)),
    ).toEqual(originalIndices);
  });

  it("returns a new empty model when no selected indices exist in the model", () => {
    const model = fixtureModel();
    const filtered = filterRenderModelBySelection(model, new Set([99]));

    expect(filtered).toEqual({ decks: [] });
    expect(filtered).not.toBe(model);
    expect(model.decks).toHaveLength(3);
  });
});
