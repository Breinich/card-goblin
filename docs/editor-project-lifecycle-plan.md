# Editor project lifecycle and multi-project cloud plan

**Status:** approved for implementation on 2026-08-22. This is the execution and
acceptance brief for DESIGN decision ◆53. The project-file compatibility contract
in this document is a release blocker, not a best-effort goal.

## Outcome

Opening the editor begins at an explicit project boundary. No demo, autosave,
asset library, or cloud copy becomes active until the user chooses what to open.

- Every user can create a named project from Blank, Poker Deck, TCG, or Party
  Game; import a CardGoblin project file; or continue the existing browser
  project when one is available.
- An authenticated admin can additionally open any previously created cloud
  project. A new or imported admin project is durably created in the cloud
  before editing begins.
- Authentication is owned by `/admin`. The editor contains no sign-in or
  sign-out controls.
- The status bar replaces **Reset to demo** with **New / Open Project**.
- Project names persist locally, sync to the cloud, can be renamed, and may be
  carried by project files without coupling storage identity to display text.
- Starter project files live in the repository's `template_projects/`
  directory and are discovered at build time. Their content is not copied by
  hand into application source.

This is a project-lifecycle redesign around the existing compiler and editor
store. The compiler, `EditorSeed`, resolved `RenderModel`, preview/PDF behavior,
and sheet-editing contracts remain unchanged.

## Execution status — 2026-08-22

Implementation slices 1–10 are complete in the working tree, including the
compatibility goldens, generated starter registry, lifecycle coordinator,
`/admin`, named cloud routes, project-scoped local storage, verified immutable
asset transfer, guarded switching, chooser/editor integration, and public copy.
The independent adversarial pass found and drove regression coverage for
outgoing-project overwrite, stale/cancelled activation, failed cloud drains,
legacy Continue teardown, retained browser-project discovery, asset-cache
invalidation, legacy `default` migration, creation Retry identity, production
CORS, cross-tab sign-out, hung requests, list refresh, transient UI reset, and
mixed-snapshot export.

The only intentionally incomplete product content is the owner-authored
`poker-deck.cardgoblin.json`, `tcg.cardgoblin.json`, and
`party-game.cardgoblin.json` under `template_projects/`. Their buttons remain
visibly unavailable rather than falling back to another project. Strict starter
verification and the remaining production/two-device manual matrix are release
gates once those files are supplied.

Final implementation verification is green: 2,065 automated tests, TypeScript,
the production build, and whitespace validation pass. The final adversarial
review reported no actionable P0–P2 findings. Residual release work is limited
to the owner-authored starter files and the real-browser/multi-tab/live-R2
manual matrix described below.

## Non-negotiable compatibility invariant

Every valid project file emitted by the current application must remain
importable after this feature. Code, sheets, edited-row state, orphaned cell
data, asset names, MIME types, and asset bytes must survive the import/export
round trip.

The invariant is enforced in both directions:

1. Current v1 files (`{version: 1, code, sheets}`) import into the new editor.
2. Current v2 files (`{version: 2, code, sheets, assets}`) import into the new
   editor, byte-exact for every asset.
3. New files remain version 2 and add only an optional top-level `name` field.
   The current v2 reader ignores unknown fields, so a new file still imports in
   the pre-feature application without losing code, sheets, or assets.
4. A new file imported into the new editor preserves its project name. A file
   without a valid name receives the editable import-name default in the
   chooser.
5. Cloud IDs, revisions, timestamps, local cache IDs, and synchronization state
   never enter the portable file. They are storage metadata, not project
   content.
6. The existing filename rule remains unchanged: a single compiled Card block
   uses its Card name; otherwise export uses
   `cardgoblin-project.cardgoblin.json`. The display project name is stored
   inside the JSON and does not silently change download filenames in this
   slice.

Before project-file code is refactored, canonical v1 and v2 outputs from the
current exporter must be committed as golden fixtures. Those fixtures are
necessary but not sufficient: a frozen current-codec oracle plus a generated
compatibility matrix must cover the full old acceptance boundary. Tests must
prove:

- each golden file parses through the new reader;
- importing then exporting retains all content and bytes;
- a new v2-plus-name file parses through a frozen copy of the current v2 reader;
- empty, zero-byte, and maximum-size assets; arbitrary byte patterns;
  property-generated current-valid `image/*` spellings; current-valid asset
  names longer than the cloud's old 100-character cap; multiple sheets;
  edited-row flags; empty and orphaned cells; Unicode content; and unknown
  top-level fields retain their current behavior;
- invalid files still fail atomically and never mutate active content or assets;
- exports still abort rather than producing an incomplete backup when any
  listed asset cannot be read; and
- export/re-import runs automatically after every new lifecycle entry path,
  not only in the manual matrix.

No migration is allowed to delete or overwrite a legacy local or cloud copy
until its replacement has been written and read back successfully.

## Terminology and boundaries

`StarterProjectId` is the UI/application term. It avoids confusion with Goblin
Script's `Template:` declaration.

Project content remains:

```ts
interface EditorSeed {
  code: string;
  sheets: SheetsState;
}
```

Project identity and lifecycle live outside the editor store:

```ts
type ProjectLocation = "browser" | "cloud";

interface ActiveProject {
  location: ProjectLocation;
  id: string;
  name: string;
  revision: number | null;
}
```

- `id` is immutable and is the only value used in storage keys.
- `name` is mutable display metadata and is never used in an R2 or IndexedDB
  key.
- A browser project and a cloud project's browser cache use distinct IDs.
- The editor store continues to own only code, sheets, compilation, and row
  operations.
- The asset store and persistence adapters bind to an active project ID.
- A versioned project-metadata store owns the active name/location/revision and
  exposes its own subscription and awaited flush contract.

## Project-name contract

Both anonymous and authenticated users name a project when creating it from a
starter or importing a file.

- The field is required before the action can start.
- The value is Unicode, normalized to NFC, trimmed, 1–80 Unicode code points,
  and contains no control characters.
- Names do not need to be unique; immutable IDs distinguish projects.
- The chooser supplies an editable suggestion:
  - Blank → `Untitled Project`
  - Poker Deck → `Poker Deck`
  - TCG → `TCG`
  - Party Game → `Party Game`
  - Import → valid file name, otherwise the file's base name, otherwise
    `Imported Project`
  - migrated local project → `Browser Project`
  - migrated cloud `default` project → `Legacy Cloud Project`
- Opening an existing browser or cloud project does not force a rename.
- Rename is available from the active project's editor chrome and from the
  cloud-project list where practical.
- A cloud rename is a normal revision-checked project update. An unresolved
  conflict cannot be bypassed by renaming.

## Starter project source contract

`Blank` is built in as `{code: "", sheets: {}}`. The other starters are normal
CardGoblin project-file v2 documents placed in the repository root's
`template_projects/` directory:

```text
template_projects/
  poker-deck.cardgoblin.json
  tcg.cardgoblin.json
  party-game.cardgoblin.json
```

Those three content files are deliberately absent until the product owner
designs them by using the anonymous editor and exporting them.

The implementation must add a deterministic build-time discovery step that:

1. scans only direct `*.cardgoblin.json` children of `template_projects/`;
2. sorts by stable starter ID, never filesystem enumeration order;
3. generates a metadata-only typed registry consumed by the statically
   rendered editor;
4. uses the same pure project-file parser as user imports;
5. fails validation/CI for duplicate IDs, unexpected required-file names,
   invalid project JSON, invalid assets, or a compile error in a starter;
6. emits one statically analyzable lazy `import()` loader per starter so the
   selected project's JSON/base64 assets are fetched in a separate chunk only
   after selection;
7. deep-clones the parsed seed and assets for every creation; and
8. never reads the filesystem from the browser and never turns `/editor` into
   a dynamic server route.

The generated registry is build output. Template authors edit only the exported
project files; they do not edit a second copy of the Goblin code, sheets, or
assets. Tests assert the exact schema and card count of each starter after its
fixture is added. The early registry slice may represent a missing owner-authored
file as unavailable so implementation can proceed, but the chooser is not
release-ready in that state. The final chooser integration makes any of the
three missing required files a build/CI failure. A missing starter never
silently falls back to Blank or the Monster demo. Build verification must also
prove that no non-selected starter payload or base64 asset bytes enter the
initial `/editor` JavaScript; adding starter content must not inflate the route
by the sum of every project file.

## Supported image formats

The current local library accepts every MIME string beginning with `image/`,
while the reviewed cloud boundary accepts only:

- `image/png`
- `image/jpeg`
- `image/gif`
- `image/webp`
- `image/avif`
- `image/svg+xml`

Examples currently accepted locally but not by cloud include BMP, TIFF,
HEIC/HEIF, ICO, APNG when labeled `image/apng`, Photoshop images, unknown image
subtypes, parameterized MIME values such as `image/png; charset=x`, and
case variants such as `image/PNG`.

The feature establishes one shared exact allowlist—the six types above—for all
new drawer uploads, bundled-template validation, and ordinary cloud ingestion.
Picker hints are not enforcement; the asset store and all new-ingestion/API
boundaries enforce the same predicate. **Backup export never filters the active
asset library:** every grandfathered asset must be serialized with its original
name, MIME, and bytes.

The old local/cloud boundary also differs in two non-MIME ways: current local
projects permit zero-byte assets and valid asset names longer than the cloud's
100-character cap. New uploads adopt cloud parity: non-empty through the 2 MB
cap and names at most 100 characters. A previously exported valid v2 file may
contain any of those three legacy cases. The new reader must recover such a
file rather than invalidate the user's backup:

- anonymous import may open it locally and preserves the original bytes on
  re-export;
- admin cloud creation remains blocked and names every incompatible asset and
  reason—unsupported MIME, zero bytes, or overlong name—until the user removes
  or replaces it;
- the drawer does not allow a new unsupported upload;
- this grandfathering path cannot be used by bundled starter projects.

These narrow exceptions are required to satisfy project-file compatibility.
They do not perpetuate the old mismatch for newly added assets. Importing and
then re-exporting a legacy local project preserves all grandfathered assets
unchanged; re-export is not treated as new asset ingestion.

## Initial editor bootstrap

The editor route remains statically renderable. Its server and first client
render contain an empty editor shell plus the blocking chooser; they do not
contain the Monster demo or a restored project.

```text
checking-session
  ├─ anonymous ────────────────────────┐
  └─ admin → loading-cloud-projects ───┤
                                       v
                                    choosing
                                       |
                       opening / importing / creating
                                       |
                                     ready
```

Until `ready`:

- editor persistence, the real IndexedDB adapter, and cloud subscriptions do
  not attach to the editor store;
- the underlying editor is inert and hidden from assistive technology;
- the chooser owns focus and has `role="dialog"` and `aria-modal="true"`;
- there is no close button; Escape and backdrop clicks do nothing;
- only an authoritative 401 from the session endpoint selects anonymous mode;
  a network error, 5xx, malformed response, or timeout remains in a blocking
  **Could not check session** state with Retry and a link to `/admin`;
- a failed cloud list keeps the admin chooser open with Retry and a link to
  `/admin`; it does not misrepresent an authenticated admin as anonymous;
- file, migration, asset, and cloud errors leave the active project untouched.

The initial chooser is non-dismissible. The **New / Open Project** chooser
opened after an active project reaches `ready` may have Cancel because a safe
active project already exists beneath it.

## Anonymous flow

The anonymous chooser offers:

1. Continue browser project, only when a valid saved project exists.
2. Blank.
3. Poker Deck.
4. TCG.
5. Party Game.
6. Import project file.

Creation/import requires the project-name field. Opening the saved browser
project uses its existing name.

Anonymous mode retains one active browser-project slot in this slice. Creating
or importing another browser project when one already exists uses the existing
two-step destructive posture and recommends export first. Cloud project caches
are not that slot and can never overwrite it.

## Admin flow

An authenticated admin sees everything in the anonymous chooser plus a list of
cloud project summaries sorted by most recently updated. The cloud list shows
at least name and last-updated time and has deterministic empty, loading, retry,
and damaged-project states.

- Choosing a starter creates a new named cloud project.
- Importing a file creates a new named cloud project; it never overwrites the
  currently active or arbitrarily selected cloud project.
- Choosing a cloud item opens that exact project ID and binds synchronization
  only after its content and assets have loaded coherently.
- Opening a cloud project reconciles its remote revision against any dirty
  project-scoped browser cache. A divergent cache requires the existing
  explicit local/cloud choice and is never overwritten merely because the
  project was selected from the list.
- Continue browser project opens local-only work. It is not silently promoted
  to cloud.
- Initial cloud creation is blocking. The chooser shows progress, then enters
  the editor only after project and asset durability are confirmed.
- On creation failure, the chooser remains open with Retry. There is no
  continue-locally action in the admin flow. An admin who needs local-only work
  signs out at `/admin` and reopens the editor anonymously.
- Creation Retry is idempotent: one chooser operation retains the same project
  ID, idempotency token, and payload fingerprint until it succeeds or the user
  leaves the flow.

## Admin authentication surface

`/admin` is the sole authentication UI.

- Signed out: username/password form backed by the existing login route.
- Signed in: authenticated status and a sign-out action backed by the existing
  logout route.
- The page is `noindex, nofollow`, omitted from the sitemap, and need not appear
  in public navigation.
- The editor performs a no-store `GET /api/cloud/session` after mount to choose
  anonymous or admin bootstrap while keeping `/editor` static.
- The editor contains no sign-in form, sign-in button, or sign-out button.
- An expired session stops remote writes and displays a status/link directing
  the user to `/admin`; it never embeds credentials in the editor.
- Sign-out notifies open same-origin editor tabs through `BroadcastChannel` or
  an equivalent storage event. A 401 remains the authoritative fallback.

The production apex host must redirect consistently to the configured `www`
canonical host because the existing `__Host-` cookie is host-only.

## Cloud representation and routes

Cloud storage becomes:

```text
projects/<projectId>/project.json
projects/<projectId>/assets/<sha256>
```

Asset objects are immutable and content-addressed. They are conditionally
created at their hash key, stored with the exact reviewed logical image MIME,
and never overwritten or moved by a rename. The manifest is authoritative for
the logical asset name and repeats that verified MIME type:

```ts
interface CloudAssetManifestEntry {
  name: string;
  mime: SupportedImageMime;
  size: number;
  hash: string; // lowercase SHA-256; also derives the immutable object key
}
```

Two devices replacing an asset with the same logical name but different bytes
therefore upload to different keys. The revision/ETag compare-and-swap chooses
which manifest becomes authoritative without either device overwriting the
other manifest's bytes. Identical hashes imply identical verified bytes and may
safely share an object.

The manifest contains server-owned identity metadata plus project content:

```ts
interface StoredCloudProject {
  formatVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  starterId?: StarterProjectId;
  revision: number;
  creationTokenHash?: string; // required on every newly created ◆53 project
  creationFingerprint?: string; // absent only on migrated legacy objects
  code: string;
  sheets: PersistedSheets;
  assets: CloudAssetManifestEntry[];
}
```

Routes:

| Method | Route | Contract |
|---|---|---|
| `GET` | `/api/cloud/session` | 200 authenticated, 401 otherwise; no-store |
| `GET` | `/api/cloud/projects` | paginated project summaries |
| `POST` | `/api/cloud/projects` | idempotent conditional creation; validates ID/name/token/fingerprint/payload |
| `GET` | `/api/cloud/projects/:projectId` | one validated project |
| `PUT` | `/api/cloud/projects/:projectId` | revision and strong-ETag guarded update/rename |
| asset routes | `/api/cloud/projects/:projectId/assets/:sha256` | conditional immutable PUT and GET presigns |

IDs use one closed generator/validator and may not contain path separators or
be derived from the project name. Every route validates the ID before building
an object key.

R2 listing must support continuation tokens and project-prefix/delimiter
semantics. It must not treat each asset object as a project and must not stop at
the first 1,000 objects. The chooser either follows every page before declaring
the list complete or exposes an accessible, stable-cursor **Load more** action;
projects after page one must be reachable. A shared mutable
`projects/index.json` is avoided because it would introduce a global
compare-and-swap bottleneck.

The existing `projects/default/project.json` appears as project ID `default`.
Missing metadata is synthesized as **Legacy Cloud Project** and upgraded on its
next successful revision-checked write. A legacy manifest entry without the new
object layout resolves from `projects/default/assets/<name>`; before the next
manifest write, the client copies, GET-verifies, and references the immutable
hash-keyed object. Legacy name-keyed objects remain untouched and recoverable.
The existing project is never orphaned by the new list.

## Durable admin creation

A successful admin creation means a complete project has been read back and
verified; it does not mean that a debounced save or upload has merely been
scheduled.

For every starter or import:

1. validate the complete source, all assets, and the name without changing
   active editor state;
2. allocate one immutable project ID and one random idempotency token for this
   chooser operation and retain both across Retry;
3. for every asset, compute SHA-256, conditionally create the immutable
   `assets/<sha256>` object, obtain a presigned GET, download the stored bytes,
   compute SHA-256 again in the browser, compare it to the original local hash,
   and retain the server's signed verification receipt as request-only state;
4. only after every asset verifies, conditionally create revision 1 with an
   idempotency-token hash and deterministic payload fingerprint, carrying the
   receipts beside the manifest rather than storing them in it;
5. immediately GET and validate the stored manifest, then bind the active
   project; and
6. enter the editor.

Grandfathered legacy assets that violate the new shared constraints block at
step 1 with an actionable list. An asset-free starter simply skips step 3.

If the manifest write succeeds but its response is lost, Retry reuses the same
ID and token. The server reads the existing object: an exact token/fingerprint
match is idempotent success and is adopted; any other existing object is a real
409 collision. Retry never allocates a second project or turns an ambiguous
response into a duplicate.

An upload failure never publishes a manifest naming a missing object. Removing
or renaming an asset updates only the revisioned manifest; it never moves or
immediately deletes immutable bytes that another revision/device may still
reference. Unreferenced objects from replacement or abandoned creation may be
garbage-collected in a separately reviewed maintenance pass; they do not make
a project visible in the list.

Subsequent code/sheet edits retain the existing long cloud debounce and local
first persistence. Asset changes retain immediate transfer into immutable
hash-keyed objects, but the confirmed remote-hash record is populated only
after presigned GET plus SHA-256 comparison, not merely after PUT
acknowledgement. Exact entries in the current verified v2 manifest require no
second R2 byte read; a new/changed entry supplies its project- and metadata-bound
server receipt. Clients without receipts use bounded-concurrency byte verification
as a compatibility fallback. A green status is set only after an
authoritative pull or a successful manifest write whose assets meet that rule.

## Atomic staging and commit

The chooser must not use the current fire-and-forget `replaceAll` import path or
the current cloud pull sequence that replaces code before assets download. It
uses an explicit inactive `StagedProject` transaction:

1. parse content and metadata into memory without touching active stores;
2. fetch/decode/validate the complete asset set into a project-scoped staging
   namespace that is not visible to the active asset adapter;
3. verify expected names, MIME values, sizes, hashes, and bytes;
4. write the new project snapshot/metadata under its inactive ID;
5. commit one small active-project pointer only after all fallible work above
   succeeds; and
6. synchronously bind the already-prepared editor seed, asset adapter, metadata
   snapshot, and subscriptions while the modal still keeps the editor inert.

The final in-memory bind must contain no asynchronous storage work and no
expected failure path. If staging or the active-pointer write fails, the old
active pointer, editor seed, assets, and subscriptions remain authoritative;
the chooser reports the error and Retry can reuse or replace the inactive
staging namespace. Partially staged data is unreachable and may be cleaned up
later. Only after a successful pointer commit may old browser-slot data become
eligible for cleanup.

## Project-scoped local data

The local cache layer must prevent cross-project asset and save collisions.

- Browser-project content/name has a dedicated active slot and stable local ID.
- Every cloud project cache is keyed by its cloud project ID.
- IndexedDB assets use project ID plus asset name as their identity.
- The asset store's public singleton may remain reference-stable, but its
  adapter is rebound only at a controlled project switch.
- Existing `cardgoblin.project.v1` and the current global IndexedDB asset store
  migrate into the legacy browser project.
- IndexedDB upgrades from version 1 by creating a new store with compound
  identity `[projectId, name]`; the existing `assets` store/key path is retained
  and copied, never changed in place.
- Migration is idempotent and records a completion marker only after verifying
  count, name, MIME, size, and bytes in the new store. The old localStorage keys
  and IDB store remain until the new records are written and read back.
- Startup discovery of legacy content/assets is read-only. Migration runs only
  when the user chooses browser recovery; selecting a starter or cloud project
  never consumes or deletes legacy data.
- If legacy assets exist without a valid autosave, the chooser still offers
  browser recovery using an empty seed and the recovered assets, while any
  corrupt autosave retains its quarantine copy.
- Corrupt local content retains the existing quarantine behavior.
- Anonymous data and cloud caches are never interchangeable merely because a
  user signs in or signs out.

## Safe project switching

**New / Open Project** replaces **Reset to demo** in the status bar.

Before leaving an active project:

1. flush current compilation;
2. await local persistence;
3. drain or explicitly abort every in-flight manifest and asset GET/PUT/DELETE
   for the old immutable project ID, and await or explicitly resolve its remote
   flush when it is a cloud project;
4. detach editor, asset, and sync subscriptions from the old immutable ID;
5. load and validate the selected project's content and complete asset set;
6. atomically replace the editor seed and asset adapter;
7. attach persistence/sync for the new immutable ID;
8. reset project-specific transient panel state and reach `ready`.

The cloud controller's current fire-and-forget `flush()` is insufficient. The
switch operation needs `drainProject(projectId)` plus an awaited flush result.
Every request captures its immutable project ID in its URL/key at creation;
disposing a subscription never retargets an issued request. Abort controllers
stop work where possible, while an epoch guard prevents any unavoidable late
response from mutating the newly active client state. A server-side write that
has already committed can therefore affect only its original project A, never
project B.

Project metadata has its own versioned, subscribable persistence channel.
Renaming alone marks local/cloud state dirty, participates in pagehide and
awaited switch flushes, and increments the cloud revision. Export Project
flushes and reads the active metadata snapshot atomically with code/sheets so
the optional file name cannot lag behind the visible project name.

Project-specific component state—active sheet, sheet rename state, column
widths, scroll positions, and selected preview card/face—is reset or keyed by
active project ID. Truly global view preferences such as zoom may remain global
only if deliberately documented and tested.

## Conflict and failure posture

Existing data-safety behavior remains:

- revisions plus R2 strong ETags prevent stale overwrite;
- immutable content-addressed asset objects ensure a losing device cannot
  overwrite the bytes referenced by the winning manifest;
- divergent copies require an explicit cloud/local choice;
- a partial asset pull or upload never claims Synced;
- remote asset mutation is suppressed while authority is unresolved;
- ordinary mid-session cloud failure preserves the local cache and allows
  continued editing;
- initial admin project creation is the narrower exception that blocks with
  Retry, per the approved product decision.

Conflict state, confirmed remote asset hashes, last-synced time, pending writes,
and controller epochs are scoped by project ID. No revision learned for one
project is valid for another.

## UI acceptance criteria

### Initial chooser

- It is visible over an empty editor on the first render.
- It cannot be dismissed by close control, Escape, or backdrop.
- Keyboard focus cannot enter the editor.
- Every starter and import path has one clear accessible name.
- The required editable project-name field participates in validation.
- Continue browser project appears only when recovery is valid.
- Admin-only cloud content is absent for anonymous users.

### Active editor

- Homepage/header calls to action consistently say **Open Editor** and route to
  `/editor`.
- There is no **Sign in** button or credential form anywhere in editor markup.
- There is no **Reset to demo** action.
- **New / Open Project** reopens the chooser without first discarding work.
- The active project name is visible and editable.
- Cloud status always names the active cloud project or clearly says the
  project is local-only.
- Export Project continues producing a self-contained compatible backup.

### Admin page

- `/admin` shows sign-in when signed out and sign-out when signed in.
- Successful sign-in followed by Open Editor produces the admin chooser.
- Signing out followed by Open Editor produces the anonymous chooser.
- Signing out in another tab stops editor cloud writes without deleting local
  data.

## Test and verification plan

### Mandatory automated gates

- Golden, frozen-codec, and generated project-file compatibility suites
  described above.
- Starter discovery, deterministic ordering, parser validation, deep-clone,
  lazy-load/bundle isolation, compile, exact schema, and card-count tests.
- Bootstrap reducer tests for every phase, role, retry, and stale async result.
- Static markup/accessibility tests for the blocking and post-start chooser.
- Tests proving no persistence, asset, or cloud attachment before `ready`.
- `/admin`, session, authorization, sign-in, and sign-out route/component tests.
- Project-ID validation and path-isolation tests.
- R2 project listing pagination, delimiter, damaged entry, and legacy-default
  migration tests, including chooser access to a project after page one.
- Idempotent creation tests where asset PUT, manifest PUT, and the response fail
  independently; Retry must adopt the same project or report a real collision.
- Presigned PUT → GET → SHA-256 verification tests that corrupt stored bytes and
  prove the manifest is not created.
- A two-device same-name/different-bytes race test proving the winning manifest
  always resolves to its own hash-verified immutable object; the losing write
  receives a manifest conflict without corrupting those bytes.
- Per-project revision, ETag, conflict, asset-integrity, and failure tests.
- Project A/B switch tests proving late requests cannot cross-write.
- Local autosave/IndexedDB migration, quarantine, and isolation tests.
- MIME parity tests at drawer, project-file, template, manifest, and presign
  boundaries, plus MIME/zero-byte/overlong-name legacy recovery exceptions.
- Rename-only dirty, export-name, pagehide, and project-switch flush tests.
- Atomic staging failure tests at every asynchronous step; the old content and
  asset adapter must remain active.
- In-flight asset-operation drain/abort tests as well as manifest flush tests.
- Existing compiler/store/preview/PDF/project-file/cloud suites remain green.
- `npm test`, `npx tsc --noEmit`, and `npm run build` pass; `/editor` remains
  statically generated.

### Required manual browser matrix

- Fresh and returning anonymous browsers.
- v1 and v2 imports, with and without assets and names.
- Keyboard-only chooser, mobile layout, Escape/backdrop behavior.
- Admin sign-in/sign-out and session expiry.
- Every starter once owner-authored fixtures exist.
- Two devices creating/opening/editing the same cloud project.
- Two tabs and a forced conflict.
- Offline initial creation and Retry.
- Failed/partial asset upload and pull.
- Project switching with a pending local and cloud save.
- Export and re-import after every creation/open path.
- PDF and data export after every creation/open path.

## Implementation sequence

1. **Compatibility harness.** Capture golden v1/v2 fixtures and extract the pure
   project-file codec before changing lifecycle code.
2. **Starter source seam.** Add build-time `template_projects/` discovery and
   Blank; owner-authored starter content can land independently later.
3. **Project coordinator.** Add the bootstrap state machine and an inert empty
   shell without yet enabling multi-project cloud writes.
4. **Admin surface.** Extract lightweight auth transport, add `/admin` and the
   no-store session endpoint, then remove authentication UI from the editor.
5. **Cloud identity.** Add IDs, metadata, idempotent list/create/project-scoped
   routes, pagination, read-back asset verification, and `default`
   compatibility.
6. **Local identity.** Project-scope browser caches and IndexedDB assets, with
   read-back migration and quarantine preservation.
7. **Synchronization binding.** Parameterize transport/controller by immutable
   project ID; add atomic staging, metadata dirty tracking, request draining,
   and awaited epoch-guarded switching.
8. **Chooser integration.** Add the anonymous/admin choices, naming, atomic
   import/create/open, and blocking Retry behavior.
9. **Active-project UI.** Add rename and New / Open Project; remove Reset to
   demo; reset project-specific panel state on switch.
10. **Documentation and copy.** Update the wiki, cloud/deployment/development
    docs, landing-page promises, entry-point labels, and screenshots in the
    same behavior-changing commits.
11. **Release gate.** Run all automated checks and the two-device manual matrix;
    project-file golden compatibility is mandatory for release.

Each slice keeps the full build green. Storage migrations land before any UI
path that depends on them, and legacy deletion is deferred until verified.

## Documentation change map

Implementation must amend, rather than leave contradictory claims in:

- `docs/wiki/getting-started/01-what-is-cardgoblin.md`
- `docs/wiki/getting-started/02-quickstart.md`
- `docs/wiki/getting-started/03-the-editor.md`
- `docs/wiki/export-and-project/02-autosave.md`
- `docs/wiki/export-and-project/03-project-files.md`
- `docs/wiki/export-and-project/04-assets.md`
- `docs/wiki/export-and-project/06-roadmap.md`
- `docs/cloud-sync.md`
- `docs/deployment.md`
- `docs/development.md`
- `CLAUDE.md`
- landing-page and site-header copy

Admin mechanics remain in maintainer/operator documentation, not the public
wiki. Public documentation may state that authenticated projects sync without
publishing private deployment details.

## Explicitly deferred

- The actual Poker Deck, TCG, and Party Game content; the owner will author and
  export those projects into `template_projects/`.
- A general anonymous multi-project browser library. This slice preserves one
  named browser project plus isolated cloud caches.
- Multi-user accounts, permissions, sharing, collaboration, or per-user cloud
  namespaces. The current single-admin credential remains the model.
- Deleting cloud projects, cloud-project duplication, and automatic cleanup of
  unreferenced immutable objects from replacement or failed creation.
- Automatic transcoding of grandfathered unsupported image formats.
- Changing the current exported download filename rule.
