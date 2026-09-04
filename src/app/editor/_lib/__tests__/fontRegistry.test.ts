import { describe, expect, it } from "vitest";
import { isFontUrl, readCustomFonts, registerFont } from "../fontRegistry";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("custom font registry", () => {
  it("accepts only http(s) URLs", () => {
    expect(isFontUrl("https://fonts.example.test/font.woff2")).toBe(true);
    expect(isFontUrl("data:font/woff2;base64,abc")).toBe(false);
    expect(isFontUrl("javascript:alert(1)")).toBe(false);
  });

  it("persists and replaces named font records", () => {
    const target = storage();
    registerFont({ name: "Display", source: { kind: "url", url: "https://example.test/a.woff2" } }, target);
    registerFont({ name: "Display", source: { kind: "url", url: "https://example.test/b.woff2" } }, target);
    expect(readCustomFonts(target)).toEqual([
      { name: "Display", source: { kind: "url", url: "https://example.test/b.woff2" } },
    ]);
  });
});
