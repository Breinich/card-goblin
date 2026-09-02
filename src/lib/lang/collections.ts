/** Shared textual codec for Set<Enum>/List<Enum> physical cells (◆55). */

export type CollectionKind = "Set" | "List";

export type CollectionCellIssue =
  | { kind: "unknown"; index: number; value: string }
  | { kind: "empty"; index: number; value: "" }
  | { kind: "duplicate"; index: number; value: string };

export interface CollectionCellResult {
  /** Known members in runtime order: enum declaration order for Set, cell order for List. */
  items: readonly string[];
  /** Canonical valid-cell text. Invalid callers should preserve their original raw text. */
  canonical: string;
  issues: readonly CollectionCellIssue[];
  valid: boolean;
}

/** Decode and validate a raw collection cell. Whitespace-only is the valid empty collection. */
export function parseCollectionCell(
  raw: string,
  options: { kind: CollectionKind; enumName?: string; cases: readonly string[] },
): CollectionCellResult {
  const { kind, cases: enumCases } = options;
  if (raw.trim() === "") {
    return { items: [], canonical: "", issues: [], valid: true };
  }
  const allowed = new Set(enumCases);
  const seen = new Set<string>();
  const sourceValues: string[] = [];
  const issues: CollectionCellIssue[] = [];
  for (const [index, part] of raw.split(",").entries()) {
    const value = part.trim();
    if (value === "") {
      issues.push({ kind: "empty", index, value: "" });
      continue;
    }
    if (!allowed.has(value)) {
      issues.push({ kind: "unknown", index, value });
      continue;
    }
    if (kind === "Set" && seen.has(value)) {
      issues.push({ kind: "duplicate", index, value });
      continue;
    }
    seen.add(value);
    sourceValues.push(value);
  }
  const emitted = new Set<string>();
  const items = kind === "Set"
    ? enumCases.filter((caseName) => {
        if (!seen.has(caseName) || emitted.has(caseName)) return false;
        emitted.add(caseName);
        return true;
      })
    : sourceValues;
  return {
    items,
    canonical: formatCollectionCell(items),
    issues,
    valid: issues.length === 0,
  };
}

export function formatCollectionCell(values: readonly string[]): string {
  return values.join(", ");
}
