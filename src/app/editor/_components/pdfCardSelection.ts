/**
 * Pure helpers for selecting generated card instances for PDF export.
 *
 * Selection keys are the stable, zero-based `CardMeta.projectCardIndex`
 * values. The text syntax is intentionally one-based, matching
 * `@project_card` and the number a person sees in the editor.
 */

import type { RenderModel } from "@/lib/lang";

export type ProjectCardSelection = ReadonlySet<number>;

export type CardNumberParseErrorCode =
  | "empty-input"
  | "empty-item"
  | "malformed-item"
  | "descending-range"
  | "out-of-range";

export interface CardNumberParseError {
  code: CardNumberParseErrorCode;
  /** Zero-based comma-delimited item position. */
  itemIndex: number;
  /** The trimmed item text (empty for a doubled or trailing comma). */
  token: string;
  /** Half-open character offsets into the original input. */
  startOffset: number;
  endOffset: number;
  message: string;
}

export interface CardNumberParseResult {
  /** Valid entries, converted to zero-based projectCardIndex values. */
  indices: ProjectCardSelection;
  /** All parse errors, in input order. Do not apply `indices` when non-empty. */
  errors: readonly CardNumberParseError[];
}

function error(
  code: CardNumberParseErrorCode,
  itemIndex: number,
  token: string,
  startOffset: number,
  endOffset: number,
  message: string,
): CardNumberParseError {
  return { code, itemIndex, token, startOffset, endOffset, message };
}

function outOfRangeMessage(cardNumber: string, cardCount: number): string {
  return cardCount === 0
    ? "No generated cards are available."
    : `Card ${cardNumber} is out of range. Enter a number from 1 to ${cardCount}.`;
}

/**
 * Parse comma-separated card numbers and inclusive ranges, such as
 * `1-6, 16, 18`. Duplicate and overlapping entries are harmless and dedupe.
 *
 * Well-formed entries elsewhere in an invalid expression are returned to
 * make validation inspectable, but callers must not apply them while
 * `errors` is non-empty.
 */
export function parseProjectCardNumbers(
  input: string,
  cardCount: number,
): CardNumberParseResult {
  if (!Number.isSafeInteger(cardCount) || cardCount < 0) {
    throw new RangeError("cardCount must be a non-negative safe integer");
  }

  const indices = new Set<number>();
  const errors: CardNumberParseError[] = [];

  if (input.trim() === "") {
    errors.push(
      error(
        "empty-input",
        0,
        "",
        0,
        input.length,
        "Enter a card number or range, such as 1-6.",
      ),
    );
    return { indices, errors };
  }

  let rawStart = 0;
  const items = input.split(",");
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const raw = items[itemIndex];
    const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailingWhitespace = raw.match(/\s*$/)?.[0].length ?? 0;
    const token = raw.trim();
    const startOffset = rawStart + leadingWhitespace;
    const endOffset =
      token === "" ? startOffset : rawStart + raw.length - trailingWhitespace;

    if (token === "") {
      errors.push(
        error(
          "empty-item",
          itemIndex,
          token,
          startOffset,
          endOffset,
          `Item ${itemIndex + 1} is empty. Remove the extra comma or enter a card number.`,
        ),
      );
      rawStart += raw.length + 1;
      continue;
    }

    const single = /^(\d+)$/.exec(token);
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (single === null && range === null) {
      errors.push(
        error(
          "malformed-item",
          itemIndex,
          token,
          startOffset,
          endOffset,
          `“${token}” is not a card number or range. Use a number like 16 or a range like 1-6.`,
        ),
      );
      rawStart += raw.length + 1;
      continue;
    }

    const firstText = (single ?? range)![1];
    const lastText = range === null ? firstText : range[2];
    const firstBig = BigInt(firstText);
    const lastBig = BigInt(lastText);

    if (range !== null && firstBig > lastBig) {
      errors.push(
        error(
          "descending-range",
          itemIndex,
          token,
          startOffset,
          endOffset,
          `“${token}” is backwards. A range must start at or before its end.`,
        ),
      );
      rawStart += raw.length + 1;
      continue;
    }

    const max = BigInt(cardCount);
    const invalidEndpoint =
      firstBig < BigInt(1) || firstBig > max
        ? firstText
        : lastBig < BigInt(1) || lastBig > max
          ? lastText
          : null;
    if (invalidEndpoint !== null) {
      errors.push(
        error(
          "out-of-range",
          itemIndex,
          token,
          startOffset,
          endOffset,
          outOfRangeMessage(invalidEndpoint, cardCount),
        ),
      );
      rawStart += raw.length + 1;
      continue;
    }

    const first = Number(firstBig);
    const last = Number(lastBig);
    for (let cardNumber = first; cardNumber <= last; cardNumber++) {
      indices.add(cardNumber - 1);
    }
    rawStart += raw.length + 1;
  }

  return { indices, errors };
}

/** Every generated instance, including error placeholders, in model order. */
export function allProjectCardIndices(model: RenderModel): ProjectCardSelection {
  const indices = new Set<number>();
  for (const deck of model.decks) {
    for (const card of deck.cards) indices.add(card.meta.projectCardIndex);
  }
  return indices;
}

/** Instances the PDF layout can print; error placeholders remain unselectable. */
export function printableProjectCardIndices(model: RenderModel): ProjectCardSelection {
  const indices = new Set<number>();
  for (const deck of model.decks) {
    for (const card of deck.cards) {
      if (card.error === undefined) indices.add(card.meta.projectCardIndex);
    }
  }
  return indices;
}

/** Total generated instances, including unavailable error placeholders. */
export function projectCardCount(model: RenderModel): number {
  return model.decks.reduce((count, deck) => count + deck.cards.length, 0);
}

/** Compact zero-based project indices for human display without letting a
 * 2,000-card error run become a 2,000-number screen-reader announcement. */
export function formatProjectCardNumberRanges(
  indices: Iterable<number>,
  maxSegments = 12,
): string {
  const numbers = [...new Set(indices)].sort((left, right) => left - right);
  if (numbers.some((index) => !Number.isSafeInteger(index) || index < 0)) {
    throw new RangeError("project card indices must be non-negative safe integers");
  }
  if (numbers.length === 0) return "";

  const segments: Array<{ first: number; last: number }> = [];
  for (const index of numbers) {
    const previous = segments[segments.length - 1];
    if (previous !== undefined && index === previous.last + 1) previous.last = index;
    else segments.push({ first: index, last: index });
  }

  const limit = Number.isFinite(maxSegments)
    ? Math.max(1, Math.floor(maxSegments))
    : segments.length;
  const shown = segments.slice(0, limit);
  const text = shown
    .map(({ first, last }) =>
      first === last ? `#${first + 1}` : `#${first + 1}–#${last + 1}`,
    )
    .join(", ");
  const omittedCards = segments
    .slice(limit)
    .reduce((total, segment) => total + segment.last - segment.first + 1, 0);
  return omittedCards > 0
    ? `${text}, and ${omittedCards} more card${omittedCards === 1 ? "" : "s"}`
    : text;
}

/** Replace a selection. The input iterable/Set is never reused or mutated. */
export function selectOnlyProjectCards(indices: Iterable<number>): ProjectCardSelection {
  return new Set(indices);
}

/** Remove cards from a selection without mutating either input. */
export function deselectProjectCards(
  selection: ProjectCardSelection,
  indices: Iterable<number>,
): ProjectCardSelection {
  const next = new Set(selection);
  for (const index of indices) next.delete(index);
  return next;
}

/**
 * Keep only selected generated instances, preserving their existing deck and
 * card order and their original projectCardIndex values. Empty decks are
 * omitted. Card objects are safe to share under RenderModel's immutability
 * contract; model, deck, and cards-array containers are always new objects.
 */
export function filterRenderModelBySelection(
  model: RenderModel,
  selection: ProjectCardSelection,
): RenderModel {
  return {
    decks: model.decks.flatMap((deck) => {
      const cards = deck.cards.filter((card) => selection.has(card.meta.projectCardIndex));
      return cards.length === 0 ? [] : [{ ...deck, cards }];
    }),
  };
}
