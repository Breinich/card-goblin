# Admin-only cloud sync

Cloud sync is a private operator feature for the CardGoblin administrator. The
current deployment has one shared credential, named cloud projects, and infrastructure
sized for one administrator. It is **not a public product feature** and must not appear in
the public wiki, public roadmap, landing-page copy, or sitemap.

The public editor remains local-first: code and sheet rows are stored in browser
`localStorage`, uploaded assets are stored in IndexedDB, and project files are the
supported way for public users to back up or move work. This private mirror does not
change those guarantees for signed-out users.

The implementation and its behavior are retained here for maintainers. The setup,
security, and recovery runbook is in [deployment.md](deployment.md). The agreed
design is [DESIGN.md §7.8](DESIGN.md#78-editor-project-lifecycle-and-multi-project-cloud--agreed-spec-2026-08-22).

## Scope and capacity

- One administrator username and password; there are no public accounts,
  permissions, invitations, or per-user isolation.
- Multiple named cloud projects, each addressed by an immutable UUID. Display
  names never become object-storage keys.
- One administrator is the supported capacity. Do not enable or document this as a
  multi-user service without first designing and provisioning real account and data
  isolation.
- Code, sheet rows, and uploaded assets sync per project. Project files remain
  the recoverable, portable backup boundary.

## Authentication and opening

Sign in and sign out only at `/admin`. The editor has no credential form or
authentication button. On startup, an authoritative 401 selects anonymous mode;
network, server, and malformed-response failures keep the chooser blocked with Retry.

An authenticated chooser lists every readable named project and keeps damaged
manifests visible but disabled. Opening downloads and hash-verifies every referenced
asset before changing the active local pointer. If a project-scoped browser cache and
cloud differ, the chooser requires an explicit browser/cloud choice.

Creating from a starter or file uses a client UUID and idempotency token. Immutable
assets upload first; the server reads back their MIME, byte count, and SHA-256 before
conditionally publishing revision 1. A failure remains in the chooser with Retry.

## What syncs and when

- Code and sheet rows push about **10 seconds** after your last change.
- Changed images upload under immutable content-addressed keys before the next
  manifest update. Renames never move bytes, and immutable objects are not deleted
  by ordinary project edits.
- Leaving the page flushes a pending project push when possible.
- A session lasts **30 days**. Rotating `SESSION_SECRET` invalidates every session.

## Status and conflict behavior

The private status indicator reports saving, saved, offline, and conflict states.
Every push carries the revision on which it was based. If the cloud changed after
this browser last read it, the push is refused. The browser draft remains safe and
the operator reopens the project to reconcile copies.

## "Your editor has work that isn't in the cloud"

**Your editor has work that isn't in the cloud** documents the retained pre-§7.8 single-project controller and is
kept for compatibility tests while legacy routes remain available. The named-project
chooser now says that the browser has a different cached copy. In both cases, nothing
is replaced until the administrator chooses one:

- **Use cloud project** discards this browser's local project and downloads the
  cloud project and its assets.
- **Use this device's project** keeps this browser's project and uploads its code,
  rows, and complete asset library.

## Known limits

- Conflict handling is guarded last-write-wins, not merging.
- Asset uploads may precede manifest publication. Unreferenced staged bytes never
  appear in project lists and cannot be downloaded through project routes.
- Opening or importing binds a separate project-scoped local asset library and does
  not delete now-unreferenced immutable cloud objects.
- Signing out clears this browser's session only. Rotate `SESSION_SECRET` to revoke
  all remembered sessions.
- Missing cloud configuration must degrade only the private feature; signed-out
  local editing must continue to work.

## Maintenance guardrails

The behavior above is covered by the cloud client, route, storage, and component
tests. `src/lib/docs/__tests__/docFacts.test.ts` also checks the operator-facing
10-second debounce, 30-day session, and exact conflict label against implementation
constants. Keep those checks pointed at this file, never at public wiki copy.
