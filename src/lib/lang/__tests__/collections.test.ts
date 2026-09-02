import { describe, expect, it } from "vitest";
import type { TextShape } from "../index";
import {
  compileProject,
  compileSource,
  formatCollectionCell,
  parseCollectionCell,
  parse,
} from "../index";

const src = (...lines: string[]): string => `${lines.join("\n")}\n`;

const projectSource = (columnType: string, body: string[], paramType?: string): string =>
  src(
    "Enum: Tag",
    "  case Armor",
    "  case Fire",
    "  case Water",
    "Sheet: Sh",
    `  column tags: ${columnType}`,
    "  column name: Text",
    "Template: T",
    ...(paramType ? [`  param passed: ${paramType}`] : []),
    ...body.map((line) => `  ${line}`),
    "Card: C",
    "  sheet: Sh",
    "  size: poker",
    "  x_units: 20",
    "  y_units: auto",
    "  Front: T",
    ...(paramType ? ["    passed: [tags]"] : []),
  );

describe("collection cell codec", () => {
  const cases = ["Armor", "Fire", "Water"];

  it("accepts empty and canonicalizes Set in enum declaration order", () => {
    expect(parseCollectionCell("  ", { kind: "Set", cases })).toEqual({
      items: [],
      canonical: "",
      issues: [],
      valid: true,
    });
    expect(parseCollectionCell(" Fire, Armor ", { kind: "Set", cases })).toMatchObject({
      items: ["Armor", "Fire"],
      canonical: "Armor, Fire",
      valid: true,
    });
  });

  it("preserves List order and duplicates", () => {
    const result = parseCollectionCell("Fire, Armor, Fire", { kind: "List", cases });
    expect(result.items).toEqual(["Fire", "Armor", "Fire"]);
    expect(result.valid).toBe(true);
    expect(formatCollectionCell(result.items)).toBe("Fire, Armor, Fire");
  });

  it("reports unknown, empty, and duplicate Set tokens without throwing", () => {
    expect(parseCollectionCell("Fire,,Bogus,Fire", { kind: "Set", cases }).issues).toEqual([
      { kind: "empty", index: 1, value: "" },
      { kind: "unknown", index: 2, value: "Bogus" },
      { kind: "duplicate", index: 3, value: "Fire" },
    ]);
  });
});

describe("collection syntax and typing", () => {
  it("parses structured column/parameter types, calls, and ForEach bindings", () => {
    const code = projectSource("Set<Tag>", [
      "param passed: List<Tag>",
      "ForEach: [tags] as tag, i",
      "  Text:",
      "    x: [i]",
      "    y: 0",
      "    size: 1",
      "    text: [tag]",
    ]);
    const parsed = parse(code);
    expect(parsed.diagnostics).toEqual([]);
    const sheet = parsed.program.declarations.find((d) => d.kind === "SheetDecl");
    expect(sheet?.kind).toBe("SheetDecl");
    if (sheet?.kind === "SheetDecl") {
      expect(sheet.columns[0].columnType).toMatchObject({
        kind: "CollectionType",
        name: "Set",
        elementType: { name: "Tag" },
      });
    }
  });

  it("recovers from malformed type/call/ForEach punctuation", () => {
    const malformed = parse(src(
      "Sheet: A",
      "  column tags: Set<Tag",
      "Template: T",
      "  ForEach: contains([tags],) as tag i",
      "    Text:",
      "      x: 0",
      "      y: 0",
      "      size: 1",
      '      text: "survives"',
      "Template: S",
    ));
    expect(malformed.diagnostics.some((d) => d.code === "E001")).toBe(true);
    expect(malformed.program.declarations.some((d) => d.kind === "TemplateDecl" && d.name.name === "S")).toBe(true);
  });

  it("does not cascade checker diagnostics from a syntax-poisoned call", () => {
    const code = projectSource("Set<Tag>", [
      "If: contains([tags],)",
    ]);
    const result = compileSource(code);
    expect(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "E001",
    ]);
  });

  it("allows call arguments to use a let/property continuation", () => {
    const code = projectSource("Set<Tag>", [
      "let has_fire:",
      "  contains(",
      "    [tags],",
      "    Tag.Fire",
      "  )",
      "If: [has_fire]",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      '    text: "fire"',
    ]);
    const result = compileProject(code, { Sh: [{ tags: "Armor", name: "card" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front).toEqual([]);
  });

  it("rejects non-enum element types and collection virtual columns", () => {
    const result = compileSource(src(
      "Enum: Tag",
      "  case Fire",
      "Sheet: Sh",
      "  column bad: Set<Text>",
      "  virtual column derived: List<Tag> = [bad]",
    ));
    expect(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "E002",
      "E002",
    ]);
  });

  it("types contains and rejects mismatched enums, collection equality, and Text coercion", () => {
    const common = [
      "Enum: Tag",
      "  case Fire",
      "Enum: Mana",
      "  case Red",
      "Sheet: Sh",
      "  column tags: Set<Tag>",
      "Template: T",
    ];
    const errors = compileSource(src(
      ...common,
      "  If: contains([tags], Mana.Red)",
      "  If: [tags] == [tags]",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      "    text: [tags]",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
    )).diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.code)).toEqual(["E003", "E003", "E003"]);
  });

  it("rejects unknown callees and Set/List parameter mismatches", () => {
    const result = compileSource(src(
      "Enum: Tag",
      "  case Fire",
      "Sheet: Sh",
      "  column tags: Set<Tag>",
      "Template: T",
      "  param values: List<Tag>",
      "  If: mystery([values])",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
      "    values: [tags]",
    ));
    expect(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "E002",
      "E003",
    ]);
  });

  it("keeps Set/List/contains contextual and permits a root Template named ForEach", () => {
    const result = compileSource(src(
      "Enum: Set",
      "  case One",
      "Sheet: Sh",
      "  column single: Set",
      "  column contains: Text",
      "Template: ForEach",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: ForEach",
    ));
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("never throws on deeply nested calls or ForEach blocks", () => {
    const callDepth = 5_000;
    const call = `${"contains(".repeat(callDepth)}[tags]${", Tag.Fire)".repeat(callDepth)}`;
    const deepCall = projectSource("Set<Tag>", [`If: ${call}`]);

    const deepBlocks = [
      "Enum: Tag",
      "  case Fire",
      "Sheet: Sh",
      "  column tags: Set<Tag>",
      "Template: T",
    ];
    for (let i = 0; i < 510; i++) {
      deepBlocks.push(`${"  ".repeat(i + 1)}ForEach: [tags] as tag${i}, i${i}`);
    }
    // A thrown RangeError fails the test before the diagnostic assertions.
    const deepCallResult = compileSource(deepCall);
    const callErrors = deepCallResult.diagnostics.filter((d) => d.severity === "error");
    expect(callErrors).toHaveLength(1);
    expect(callErrors[0].code).toBe("E001");
    expect(callErrors[0].message).toContain("Call expressions are too deeply nested");
    expect(() => compileSource(src(...deepBlocks))).not.toThrow();
  });
});

describe("collection generation and ForEach", () => {
  const foreachBody = [
    "ForEach: [tags] as tag, i",
    "  Text:",
    "    x: [i]",
    "    y: 0",
    "    size: 1",
    "    text: [tag]",
  ];

  it("renders Set in enum order and List in cell order with duplicates", () => {
    const set = compileProject(projectSource("Set<Tag>", foreachBody), {
      Sh: [{ tags: "Fire, Armor", name: "card" }],
    });
    const list = compileProject(projectSource("List<Tag>", foreachBody), {
      Sh: [{ tags: "Fire, Armor, Fire", name: "card" }],
    });
    expect(set.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(set.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Armor",
      "Fire",
    ]);
    expect(set.model.decks[0].cards[0].exportData.tags).toBe("Fire, Armor");
    expect(list.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Fire",
      "Armor",
      "Fire",
    ]);
  });

  it("treats an empty collection as valid and emits nothing (no D003)", () => {
    const result = compileProject(
      projectSource("Set<Tag>", foreachBody),
      { Sh: [{ tags: "", name: "card" }] },
      { Sh: [true] },
    );
    expect(result.dataDiagnostics).toEqual([]);
    expect(result.model.decks[0].cards[0].front).toEqual([]);
  });

  it("flags malformed collection cells once with D001 and preserves raw export text", () => {
    const raw = "Fire,,Bogus,Fire";
    const result = compileProject(projectSource("Set<Tag>", foreachBody), {
      Sh: [{ tags: raw, name: "card" }],
    });
    expect(result.dataDiagnostics.map((d) => d.code)).toEqual(["D001"]);
    expect(result.model.decks[0].cards[0].exportData.tags).toBe(raw);
  });

  it("deduplicates one invalid collection cell across references and Cards", () => {
    const base = projectSource("Set<Tag>", [
      "ForEach: [tags] as tag, i",
      "If: contains([tags], Tag.Fire)",
    ]);
    const code = `${base}${src(
      "Card: D",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: T",
    )}`;
    const result = compileProject(code, { Sh: [{ tags: "Fire,Fire", name: "card" }] });
    const d001 = result.dataDiagnostics.filter((d) => d.code === "D001");
    expect(d001).toHaveLength(1);
    expect(result.model.decks).toHaveLength(2);
    expect(result.model.decks.every((deck) => deck.cards[0].error?.diagnostics[0] === d001[0])).toBe(true);
  });

  it("supports contains and explicit collection arguments across Template calls", () => {
    const code = src(
      "Enum: Tag",
      "  case Armor",
      "  case Fire",
      "Sheet: Sh",
      "  column tags: List<Tag>",
      "Template: Child",
      "  param item: Tag",
      "  param n: Number",
      "  Text:",
      "    x: [n]",
      "    y: 0",
      "    size: 1",
      "    text: [item]",
      "Template: Parent",
      "  param values: List<Tag>",
      "  If: contains([values], Tag.Fire)",
      "    ForEach: [values] as symbol, i",
      "      Child:",
      "        item: [symbol]",
      "        n: [i]",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Parent",
      "    values: [tags]",
    );
    const result = compileProject(code, { Sh: [{ tags: "Fire, Armor" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Fire",
      "Armor",
    ]);
  });

  it("captures caller ForEach values for lazy arguments even when the callee shadows the name", () => {
    const code = src(
      "Enum: Tag",
      "  case Armor",
      "  case Fire",
      "Sheet: Sh",
      "  column tags: List<Tag>",
      "Template: Child",
      "  param passed: Tag",
      "  Repeat: 1 as symbol",
      "    Text:",
      "      x: [symbol]",
      "      y: 0",
      "      size: 1",
      "      text: [passed]",
      "Template: Parent",
      "  ForEach: [tags] as symbol, i",
      "    Child:",
      "      passed: [symbol]",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: Parent",
    );
    const result = compileProject(code, { Sh: [{ tags: "Fire, Armor" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Fire",
      "Armor",
    ]);
  });

  it("contains supports false membership and expected-type bare cases", () => {
    const result = compileProject(projectSource("Set<Tag>", [
      "If: contains([tags], Fire)",
      "  Text:",
      "    x: 0",
      "    y: 0",
      "    size: 1",
      '    text: "fire"',
    ]), { Sh: [{ tags: "Armor", name: "card" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front).toEqual([]);
  });

  it("reports contains arity for syntactically valid zero/extra argument calls", () => {
    const zero = compileSource(projectSource("Set<Tag>", ["If: contains()"]));
    const extra = compileSource(projectSource("Set<Tag>", [
      "If: contains([tags], Tag.Fire, Tag.Armor)",
    ]));
    expect(zero.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "E003",
    ]);
    expect(extra.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "E003",
    ]);
  });

  it("forwards collections through local lets and same-typed if branches", () => {
    const result = compileProject(projectSource("Set<Tag>", [
      "let chosen: if contains([tags], Tag.Fire) then [tags] else [tags]",
      "ForEach: [chosen] as tag, i",
      "  Text:",
      "    x: [i]",
      "    y: 0",
      "    size: 1",
      "    text: [tag]",
    ]), { Sh: [{ tags: "Fire, Armor", name: "card" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Armor",
      "Fire",
    ]);
  });

  it("supports nested ForEach bindings and lexical shadowing", () => {
    const result = compileProject(projectSource("Set<Tag>", [
      "ForEach: [tags] as tag, i",
      "  ForEach: [tags] as tag, i",
      "    Text:",
      "      x: [i]",
      "      y: 0",
      "      size: 1",
      "      text: [tag]",
    ]), { Sh: [{ tags: "Fire, Armor", name: "card" }] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.diagnostics.filter((d) => d.code === "W001")).toHaveLength(2);
    expect(result.model.decks[0].cards[0].front.map((s) => (s as TextShape).text)).toEqual([
      "Armor",
      "Fire",
      "Armor",
      "Fire",
    ]);
  });

  it("shares the 500-iteration budget across nested Repeat and ForEach", () => {
    const code = projectSource("List<Tag>", [
      "Repeat: 250 as outer",
      "  ForEach: [tags] as tag, i",
      "    Text:",
      "      x: 0",
      "      y: 0",
      "      size: 1",
      "      text: [tag]",
    ]);
    const result = compileProject(code, { Sh: [{ tags: "Fire, Armor", name: "card" }] });
    expect(result.model.decks[0].cards[0].error?.diagnostics.map((d) => d.code)).toEqual([
      "D004",
    ]);
    expect(result.model.decks[0].cards[0].front).toEqual([]);
  });

  it("allows exactly 500 mixed iterations and rejects 501+ atomically", () => {
    const code = (count: number) => projectSource("List<Tag>", [
      `Repeat: ${count} as outer`,
      "  ForEach: [tags] as tag, i",
      "    Text:",
      "      x: 0",
      "      y: 0",
      "      size: 1",
      "      text: [tag]",
    ]);
    const exact = compileProject(code(250), { Sh: [{ tags: "Fire", name: "card" }] });
    const over = compileProject(code(251), { Sh: [{ tags: "Fire", name: "card" }] });
    expect(exact.model.decks[0].cards[0].front).toHaveLength(250);
    expect(exact.model.decks[0].cards[0].error).toBeUndefined();
    expect(over.model.decks[0].cards[0].front).toEqual([]);
    expect(over.model.decks[0].cards[0].back).toEqual([]);
    expect(over.model.decks[0].cards[0].error?.diagnostics.map((d) => d.code)).toEqual(["D004"]);
  });

  it("shares the iteration budget across front and back faces", () => {
    const code = src(
      "Enum: Tag",
      "  case Fire",
      "Sheet: Sh",
      "  column tags: List<Tag>",
      "Template: FrontT",
      "  Repeat: 300 as i",
      "Template: BackT",
      "  Repeat: 201 as i",
      "Card: C",
      "  sheet: Sh",
      "  size: poker",
      "  x_units: 20",
      "  y_units: auto",
      "  Front: FrontT",
      "  Back: BackT",
    );
    const result = compileProject(code, { Sh: [{ tags: "Fire" }] });
    expect(result.model.decks[0].cards[0].error?.diagnostics.map((d) => d.code)).toEqual([
      "D004",
    ]);
  });
});
