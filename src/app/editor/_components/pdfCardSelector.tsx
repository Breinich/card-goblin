"use client";

/**
 * PDF export card chooser (DESIGN.md §6.1, ◆54).
 *
 * This is a controlled, print-only view over the immutable RenderModel. The
 * owning export modal keeps the selected project-card indices; this component
 * supplies the visual grid, bulk controls, and range-entry accelerator.
 *
 * The grid reuses the preview's pure deck/row layout and windowing math. A
 * 500-card project therefore mounts only the rows around this chooser's own
 * scroll viewport, not 500 live CardSVG trees. Project-card numbers stay the
 * immutable model metadata (`meta.projectCardIndex + 1`), even when cards are
 * deselected, so the chooser, preview pager, `[project_card]`, and CSV
 * `@project_card` all name the same generated instance.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { CardInstance, Deck, RenderModel } from "@/lib/lang";
import { CardSVG } from "@/app/editor/_components/cardSvg";
import {
  formatProjectCardNumberRanges,
  parseProjectCardNumbers,
  printableProjectCardIndices,
} from "@/app/editor/_components/pdfCardSelection";
import {
  CARD_GAP_PX,
  OVERSCAN_ROWS,
  SECTION_GAP_PX,
  SECTION_HEADER_PX,
  layoutDecks,
  visibleRange,
  type DeckLayout,
} from "@/app/editor/_components/previewVirtual";

const PICKER_CARD_WIDTH_PX = 112;
const PICKER_PADDING_PX = 12;
const FALLBACK_VIEWPORT = { width: 880, height: 420 } as const;

type PickerSide = "front" | "back";

export interface PdfCardSelectorProps {
  model: RenderModel;
  selected: ReadonlySet<number>;
  onChange(next: ReadonlySet<number>, intent: "all" | "custom"): void;
  disabled?: boolean;
  /** Static-render seam; production starts on fronts with an empty range. */
  initialSide?: PickerSide;
  initialRangeText?: string;
}

function setEquals(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function cardAriaLabel(deck: Deck, card: CardInstance): string {
  const loops = Object.entries(card.meta.loopBindings)
    .map(([name, binding]) => `${name} ${binding.case}`)
    .join(", ");
  return [
    `Project card ${card.meta.projectCardIndex + 1}`,
    `deck ${deck.cardName}`,
    `sheet row ${card.meta.rowIndex + 1}`,
    `copy ${card.meta.copyIndex + 1}`,
    loops,
    card.error ? "unavailable because it has errors" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

export function PdfCardSelector({
  model,
  selected,
  onChange,
  disabled = false,
  initialSide = "front",
  initialRangeText = "",
}: PdfCardSelectorProps): ReactElement {
  const [side, setSide] = useState<PickerSide>(initialSide);
  const [rangeText, setRangeText] = useState(initialRangeText);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [rangeNotice, setRangeNotice] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const printable = useMemo(() => printableProjectCardIndices(model), [model]);
  const selectedPrintable = useMemo(
    () => new Set([...selected].filter((index) => printable.has(index))),
    [printable, selected],
  );
  const totalCards = model.decks.reduce((total, deck) => total + deck.cards.length, 0);
  const errorCards = totalCards - printable.size;
  const unavailableNumbers = useMemo(
    () =>
      formatProjectCardNumberRanges(
        model.decks.flatMap((deck) =>
          deck.cards
            .filter((card) => card.error !== undefined)
            .map((card) => card.meta.projectCardIndex),
        ),
      ),
    [model],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const measure = (): void =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewportW = viewport?.width ?? FALLBACK_VIEWPORT.width;
  const viewportH = viewport?.height ?? FALLBACK_VIEWPORT.height;
  const contentW = Math.max(0, viewportW - PICKER_PADDING_PX * 2);
  const layouts = useMemo(
    () => layoutDecks(model.decks, contentW, PICKER_CARD_WIDTH_PX),
    [contentW, model.decks],
  );
  const contentHeight = layouts.at(-1)
    ? layouts[layouts.length - 1].top + layouts[layouts.length - 1].height
    : 0;
  const maxScrollTop = Math.max(0, contentHeight - viewportH);

  const moveCardWindow = (direction: -1 | 1): void => {
    const pageDistance = Math.max(1, viewportH - SECTION_HEADER_PX);
    const next = Math.min(
      maxScrollTop,
      Math.max(0, scrollTop + direction * pageDistance),
    );
    scrollRef.current?.scrollTo({ top: next });
    // Keep React's windowing in sync immediately; the scroll event confirms
    // the browser's eventual position.
    setScrollTop(next);
  };

  const commit = (
    next: ReadonlySet<number>,
    intent: "all" | "custom" = "custom",
  ): void => {
    setRangeError(null);
    setRangeNotice(null);
    onChange(next, intent);
  };

  const applyRange = (operation: "only" | "deselect"): void => {
    const parsed = parseProjectCardNumbers(rangeText, totalCards);
    if (parsed.errors.length > 0) {
      setRangeError(parsed.errors.map((error) => error.message).join(" "));
      setRangeNotice(null);
      return;
    }
    const unavailable = [...parsed.indices].filter((index) => !printable.has(index)).length;
    const available = new Set([...parsed.indices].filter((index) => printable.has(index)));
    const next =
      operation === "only"
        ? available
        : new Set([...selectedPrintable].filter((index) => !available.has(index)));
    setRangeError(null);
    setRangeNotice(
      unavailable > 0
        ? `${unavailable} referenced card${unavailable === 1 ? " has" : "s have"} errors and cannot be selected.`
        : null,
    );
    onChange(next, "custom");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded border border-gray-700 bg-gray-900 p-3">
        <div className="mr-auto">
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-semibold text-gray-200"
          >
            {selectedPrintable.size} of {printable.size} printable card
            {printable.size === 1 ? "" : "s"} selected
          </p>
          {errorCards > 0 && (
            <details className="mt-0.5 text-xs text-amber-400">
              <summary className="cursor-pointer">
                {errorCards} card{errorCards === 1 ? " is" : "s are"} unavailable because of errors.
              </summary>
              <p className="mt-1 max-w-xl text-amber-300">
                Unavailable project cards: {unavailableNumbers}.
              </p>
            </details>
          )}
        </div>

        <div className="inline-flex overflow-hidden rounded border border-gray-600 text-xs">
          {(["front", "back"] as const).map((nextSide) => (
            <button
              key={nextSide}
              type="button"
              disabled={disabled}
              aria-pressed={side === nextSide}
              onClick={() => setSide(nextSide)}
              className={
                side === nextSide
                  ? "bg-gray-600 px-3 py-1.5 font-semibold text-white"
                  : "bg-gray-800 px-3 py-1.5 text-gray-300 hover:bg-gray-700"
              }
            >
              {nextSide === "front" ? "Front" : "Back"}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={disabled || setEquals(selectedPrintable, printable)}
          onClick={() => commit(new Set(printable), "all")}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Select all
        </button>
        <button
          type="button"
          disabled={disabled || selectedPrintable.size === 0}
          onClick={() => commit(new Set())}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Clear
        </button>

        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gray-400">
          Card numbers
          <input
            type="text"
            autoFocus
            value={rangeText}
            disabled={disabled}
            placeholder="1-6, 16, 18"
            aria-invalid={rangeError !== null}
            aria-describedby={`pdf-card-range-help${
              rangeError !== null
                ? " pdf-card-range-error"
                : rangeNotice !== null
                  ? " pdf-card-range-notice"
                  : ""
            }`}
            onChange={(event) => {
              setRangeText(event.currentTarget.value);
              setRangeError(null);
              setRangeNotice(null);
            }}
            className={
              "rounded border bg-gray-800 px-2 py-1.5 text-sm text-gray-200 " +
              (rangeError === null ? "border-gray-600" : "border-red-500")
            }
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => applyRange("only")}
          className="rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-600 disabled:opacity-50"
        >
          Select only
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => applyRange("deselect")}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Deselect
        </button>

        <p id="pdf-card-range-help" className="basis-full text-xs text-gray-500">
          Use project-wide card numbers. Commas and inclusive ranges are supported.
        </p>
        {rangeError !== null && (
          <p id="pdf-card-range-error" role="alert" className="basis-full text-xs text-red-400">
            {rangeError}
          </p>
        )}
        {rangeNotice !== null && (
          <p
            id="pdf-card-range-notice"
            role="status"
            className="basis-full text-xs text-amber-400"
          >
            {rangeNotice}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span id="pdf-card-grid-help" className="mr-auto">
          Browse the visual grid with Previous/Next, then Tab through the visible checkboxes.
        </span>
        <button
          type="button"
          disabled={disabled || scrollTop <= 0}
          onClick={() => moveCardWindow(-1)}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Previous cards
        </button>
        <button
          type="button"
          disabled={disabled || scrollTop >= maxScrollTop}
          onClick={() => moveCardWindow(1)}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          Next cards
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="h-[26rem] min-h-0 overflow-y-auto rounded border border-gray-700 bg-gray-950 p-3"
        role="region"
        aria-label="Generated cards"
        aria-describedby="pdf-card-grid-help"
      >
        {model.decks.map((deck, deckIndex) => (
          <PickerDeck
            key={deckIndex}
            deck={deck}
            layout={layouts[deckIndex]}
            side={side}
            selected={selectedPrintable}
            disabled={disabled}
            scrollTop={scrollTop}
            viewportH={viewportH}
            onToggle={(index, checked) => {
              const next = new Set(selectedPrintable);
              if (checked) next.add(index);
              else next.delete(index);
              commit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PickerDeck({
  deck,
  layout,
  side,
  selected,
  disabled,
  scrollTop,
  viewportH,
  onToggle,
}: {
  deck: Deck;
  layout: DeckLayout;
  side: PickerSide;
  selected: ReadonlySet<number>;
  disabled: boolean;
  scrollTop: number;
  viewportH: number;
  onToggle(index: number, checked: boolean): void;
}): ReactElement {
  const range = visibleRange(
    scrollTop - layout.cardsTop,
    viewportH,
    layout.rowH,
    layout.rows,
    OVERSCAN_ROWS,
  );
  const rows: ReactElement[] = [];
  for (let row = range.start; row < range.end; row++) {
    const cards = deck.cards.slice(row * layout.cols, (row + 1) * layout.cols);
    rows.push(
      <div
        key={row}
        className="flex items-start"
        style={{
          height: layout.rowH - CARD_GAP_PX,
          marginBottom: CARD_GAP_PX,
          gap: CARD_GAP_PX,
        }}
      >
        {cards.map((card) => {
          const index = card.meta.projectCardIndex;
          const checked = selected.has(index);
          const unavailable = card.error !== undefined;
          return (
            <label
              key={index}
              title={cardAriaLabel(deck, card)}
              className={
                "relative block shrink-0 overflow-hidden rounded border-2 transition " +
                (unavailable
                  ? "cursor-not-allowed border-amber-800 opacity-60"
                  : checked
                    ? "cursor-pointer border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]"
                    : "cursor-pointer border-gray-700 opacity-55 hover:opacity-90")
              }
              style={{ width: PICKER_CARD_WIDTH_PX }}
            >
              <span aria-hidden="true">
                <CardSVG
                  key={`${side}:${index}`}
                  xUnits={deck.xUnits}
                  yUnits={deck.yUnits}
                  widthMm={deck.widthMm}
                  heightMm={deck.heightMm}
                  face={side === "front" ? card.front : card.back}
                  contentHash={card.contentHash}
                  error={card.error}
                />
              </span>
              <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                #{index + 1}
              </span>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || unavailable}
                aria-label={cardAriaLabel(deck, card)}
                onChange={(event) => onToggle(index, event.currentTarget.checked)}
                className="absolute right-1 top-1 h-4 w-4 accent-sky-500"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/80 px-1.5 py-1 text-[10px] text-gray-200">
                Row {card.meta.rowIndex + 1} · Copy {card.meta.copyIndex + 1}
              </span>
            </label>
          );
        })}
      </div>,
    );
  }

  return (
    <section className="flex flex-col" style={{ marginBottom: SECTION_GAP_PX }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-2 bg-gray-950/95 backdrop-blur"
        style={{ height: SECTION_HEADER_PX }}
      >
        <h3 className="text-sm font-semibold text-gray-200">{deck.cardName}</h3>
        <span className="text-xs text-gray-500">
          {deck.cards.length} card{deck.cards.length === 1 ? "" : "s"}
        </span>
      </header>
      {range.padTop > 0 && <div style={{ height: range.padTop }} aria-hidden />}
      {rows}
      {range.padBottom > 0 && <div style={{ height: range.padBottom }} aria-hidden />}
    </section>
  );
}
