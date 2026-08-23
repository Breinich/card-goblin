---
title: Project files
status: stable
summary: Export your project as a file and import it back — backup, moving machines, and more than one project.
---

# Project files

**Export project** in the status bar downloads your whole project as a single
file. **New / Open Project → Load project file** loads one back and asks for an
editable project name before anything changes. This is how you back a project
up, move it to another browser or machine, hand it to a friend, or begin a new
named project from an existing file.

## What's in the file

Everything the editor would need to pick up where you left off:

- your Goblin script,
- every sheet's rows — including which rows you've touched, so dimmed pristine
  rows come back dimmed, and including values from columns you've removed
  (they resurface if the column comes back),
- every [uploaded asset](04-assets.md) in your Assets drawer — the
  art itself, not a reference to it, so the file is self-contained,
- the editable project name when the exporting version supplies one,
- a format version, so future versions of CardGoblin can keep reading old files.

The code-and-sheets part is the exact same shape
[autosave](02-autosave.md) writes to your browser; assets are the one addition a
project *file* carries that the autosave slot doesn't (see
[Autosave](02-autosave.md) for why). Either way it's plain JSON — readable in any
text editor, friendly to version control (art included, as base64 text).

## Export

One click, no options. The file is named after your deck — a project whose code
declares exactly one `Card:` block downloads as `<deckname>.cardgoblin.json`;
anything else (several decks, or code too broken to tell) downloads as
`cardgoblin-project.cardgoblin.json`.

Export saves what's in the editor *right now*, broken code and all — like
autosave, it never swaps in some older working version behind your back.

If your uploaded images can't be read at that moment (a browser storage
hiccup), export stops with an error instead of downloading a file without
them — a backup silently missing its art isn't a backup.

## Import

Choose **New / Open Project**, then **Choose project file**. Two things can happen:

- **The file isn't a readable CardGoblin project** — wrong file, damaged, or
  from an incompatible future version. The chooser says so, and your current
  project is untouched. Import is all-or-nothing: it never half-loads a file
  (a damaged asset entry invalidates the whole file, same as a damaged sheet
  row).
- **The file is valid** — the chooser suggests its embedded name (or the file
  name) and lets you edit it. Anonymous users replacing their active browser
  project receive an inline two-step warning and should export first if they
  still need that project. Signed-in administrators create a new cloud project;
  they do not overwrite an arbitrary existing one.

After content and assets have both been written and read back successfully, one
small active-project pointer changes and the import becomes live. A failure
leaves the project you were editing untouched. Reloading offers the new browser
project through **Continue browser project**.

### Older files still import

A file exported before uploaded assets existed has no art in it. Current v1
and v2 files still import, including grandfathered image MIME types, empty
assets, and long asset names that the older local library permitted. Those
legacy assets remain recoverable and exportable locally; new uploads use the
current reviewed image policy.

## More than one project

Anonymous editing keeps one active browser project and portable files remain
the backup/move boundary. Administrators authenticated at `/admin` also see a
named cloud-project list in the chooser and can return to those projects from
another device.
