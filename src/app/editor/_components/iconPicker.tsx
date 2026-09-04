"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { DICIER_CODES } from "@/lib/lang/dicier-codes";
import { assetStore } from "@/app/editor/_store/assetStore";

/** Browsable Dicier picker. External SVG/bitmap icons are imported into the
 * local image library and referenced as `{asset:name}` in text. */
export function IconPickerButton(): ReactElement {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200">Icons</button>
    {open && <IconPicker onClose={() => setOpen(false)} />}
  </>;
}

function IconPicker({ onClose }: { onClose(): void }): ReactElement {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const codes = useMemo(() => [...DICIER_CODES.entries()]
    .filter(([code, description]) => `${code} ${description}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const importUrl = async (): Promise<void> => {
    try {
      if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) throw new Error("Use an http(s) icon URL.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("The icon URL could not be downloaded.");
      const mime = response.headers.get("content-type")?.split(";", 1)[0] || "image/svg+xml";
      await assetStore.upload(name, mime, new Uint8Array(await response.arrayBuffer()));
      setMessage(`Imported. Use {asset:${name}}`); setUrl("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Icon import failed."); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="icon-picker-title">
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-5 text-gray-200 shadow-2xl">
      <div className="flex items-center justify-between"><h2 id="icon-picker-title" className="text-lg font-semibold text-white">Icon picker</h2><button type="button" onClick={onClose} className="rounded border border-gray-700 px-2 py-1">Close</button></div>
      <input aria-label="Search icons" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search icons" className="mt-3 w-full rounded border border-gray-600 bg-gray-950 px-2 py-1" />
      <div className="mt-3 grid max-h-72 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-4">{codes.map(([code, description]) => <button key={code} type="button" title={description} onClick={() => void navigator.clipboard?.writeText(`{${code}}`)} className="rounded border border-gray-700 p-2 text-left hover:border-emerald-500"><span className="block text-2xl" style={{ fontFamily: "Dicier-Flat-Dark" }}>{code}</span><span className="block truncate text-xs text-gray-400">{code}</span></button>)}</div>
      <section className="mt-4 border-t border-gray-700 pt-4"><h3 className="font-medium text-white">Import external icon</h3><p className="mt-1 text-xs text-gray-400">Imported icons are local assets. Use <code>{"{asset:name}"}</code> in Text/TextBox.</p><div className="mt-2 flex flex-wrap gap-1.5"><input aria-label="Icon name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="name" className="rounded border border-gray-600 bg-gray-950 px-2 py-1 text-sm" /><input aria-label="Icon URL" value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://…" className="min-w-48 rounded border border-gray-600 bg-gray-950 px-2 py-1 text-sm" /><button type="button" disabled={!name || !url} onClick={() => void importUrl()} className="rounded border border-gray-700 px-2 py-1 text-sm">Import URL</button><button type="button" disabled={!name} onClick={() => fileRef.current?.click()} className="rounded border border-gray-700 px-2 py-1 text-sm">Import file</button><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file) return; try { await assetStore.upload(name, file.type, file); setMessage(`Imported. Use {asset:${name}}`); } catch (error) { setMessage(error instanceof Error ? error.message : "Icon import failed."); } }} /></div>{message && <p role="status" className="mt-2 text-xs text-emerald-300">{message}</p>}</section>
    </div>
  </div>;
}
