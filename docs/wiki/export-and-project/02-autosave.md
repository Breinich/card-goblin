---
title: Autosave
status: evolving
summary: Your project saves itself in this browser — what persists, when, and the limits.
---

# Autosave

Your project — the code and every spreadsheet row — saves itself to this browser as
you work, and comes back when you reopen [the editor](../getting-started/03-the-editor.md). There is no
save button and nothing to configure.

## What saves, and when

- **What:** your Goblin script and all sheet rows, including which rows you've
  touched — so dimmed pristine rows come back dimmed.
- **When:** about **1 second** after your last change, and immediately when you
  switch away from the tab or close the page.
- **Where:** this browser profile on this machine, in `localStorage`. The public
  editor does not upload it.

What you had is what you get back. If you reload mid-edit with broken code, the
editor restores the broken code, squiggles and all — not some older working version.

## Uploaded assets save differently

Images you upload through the **Assets** drawer aren't part of the save above. They
write to IndexedDB **the moment you upload them**, not on the 1-second debounce, and
survive a reload. Opening or importing another project switches its code, sheets,
and asset library together, even though those are separate stores under the hood.
That is also why an old, asset-free project file opens with no uploads — see
[Project files](03-project-files.md).

## Cache is not storage

The compiled preview is kept in memory and disappears when the page closes. Your
browser may also cache CardGoblin's own JavaScript, fonts, icons, and other static
files as it would for any website. That HTTP cache can make the app load faster, but
it does not contain the authoritative copy of your project and does not move work
between browsers. Browser settings often group cache, cookies, localStorage, and
IndexedDB under **site data**; clearing all site data removes the autosave and
uploaded assets.

## New / Open Project

**New / Open Project** in the status bar returns to the project chooser. The active
project stays untouched while the chooser is open and until another project finishes
loading. Use **Cancel** to keep editing it.

## The limits

- **Browser-local means this browser.** Another browser, another device, or a
  private window cannot read a local project. To move local work across, export
  and import [project files](03-project-files.md).
- **Two tabs fight.** With the editor open in two tabs, the tab that changed last
  wins; the other tab's changes are gone on its next load.
- **It's browser storage, not a backup.** Clearing site data deletes the project.
  For anything you'd mind losing, export a [project file](03-project-files.md).
- **Private mode may turn it off.** If the browser refuses storage, the status bar
  shows a quiet **autosave off** and the editor works normally for the session — but
  nothing survives a reload.
