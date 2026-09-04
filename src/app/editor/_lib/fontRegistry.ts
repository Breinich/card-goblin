"use client";

/** Browser-local custom font registry. Font bytes are kept as data URLs in
 * localStorage so project files and font references remain portable without a
 * server. URL sources are restricted to http(s) to avoid script/data URL
 * injection through generated CSS. */
export interface CustomFontRecord {
  name: string;
  source: { kind: "url"; url: string } | { kind: "file"; mime: string; dataUrl: string };
}

const KEY = "cardgoblin.custom-fonts.v1";
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CSS_ID = "cardgoblin-custom-fonts";

export function isFontUrl(value: string): boolean { return URL_RE.test(value); }
export function isFontName(value: string): boolean { return NAME_RE.test(value); }

export function readCustomFonts(storage?: Storage): CustomFontRecord[] {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (target === null) return [];
  try {
    const raw: unknown = JSON.parse(target.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is CustomFontRecord =>
      item !== null && typeof item === "object" && isFontName(item.name) &&
      item.source !== null && typeof item.source === "object" &&
      ((item.source.kind === "url" && isFontUrl(item.source.url)) ||
       (item.source.kind === "file" && typeof item.source.mime === "string" &&
        typeof item.source.dataUrl === "string" && item.source.dataUrl.startsWith("data:"))),
    );
  } catch { return []; }
}

export async function registerFontFile(name: string, file: Blob, storage: Storage = window.localStorage): Promise<void> {
  if (!file.type || !/^font\//i.test(file.type) && !["application/octet-stream", "application/vnd.ms-opentype"].includes(file.type)) {
    throw new Error("Unsupported font file type.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await registerFont({ name, source: { kind: "file", mime: file.type, dataUrl: `data:${file.type};base64,${btoa(binary)}` } }, storage);
}

export function registerFont(record: CustomFontRecord, storage: Storage = window.localStorage): void {
  if (!isFontName(record.name)) throw new Error("Invalid font name.");
  if (record.source.kind === "url" ? !isFontUrl(record.source.url) : !record.source.dataUrl.startsWith("data:")) {
    throw new Error("Invalid font source.");
  }
  const next = [...readCustomFonts(storage).filter((font) => font.name !== record.name), record];
  storage.setItem(KEY, JSON.stringify(next));
  installCustomFontCss(next);
}

export function installCustomFontCss(fonts: readonly CustomFontRecord[] = readCustomFonts()): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(CSS_ID) as HTMLStyleElement | null;
  if (!style) { style = document.createElement("style"); style.id = CSS_ID; document.head.appendChild(style); }
  style.textContent = fonts.map((font) => {
    const source = font.source.kind === "url" ? `url("${font.source.url}")` : `url("${font.source.dataUrl}")`;
    return `@font-face{font-family:${JSON.stringify(font.name)};src:${source};font-display:swap}`;
  }).join("\n");
}

export function customFontFamily(ref: string): string {
  return ref.startsWith("font:") ? ref.slice(5) : ref;
}

export { KEY as CUSTOM_FONT_STORAGE_KEY };
