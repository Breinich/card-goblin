# Starter project source files

This directory is the source of Card Goblin's owner-authored starter projects.
It is intentionally committed before the starter content is ready.

Create each project in the anonymous editor, export it with **Export Project**,
and place the resulting self-contained project file here using these names:

```text
poker-deck.cardgoblin.json
tcg.cardgoblin.json
party-game.cardgoblin.json
```

`Blank` does not need a file; it is the built-in empty `{code: "", sheets: {}}`
seed.

The implementation described in
[`docs/editor-project-lifecycle-plan.md`](../docs/editor-project-lifecycle-plan.md)
will discover direct `*.cardgoblin.json` children at build time, generate a
deterministically ordered metadata-only typed registry with one lazy import per
file, and validate every file with the same project-file parser used for user
imports. A starter's JSON and base64 assets load only after that starter is
selected; they must not be bundled into `/editor`'s initial JavaScript. Do not
maintain a second hand-copied version of a starter in application source.

Before committing a starter file:

- open it through normal project import;
- confirm that it compiles without errors;
- confirm its exact sheet schema and generated card count;
- use only PNG, JPEG, GIF, WebP, AVIF, or SVG assets;
- export once more and use that final output here.

Project files are the compatibility boundary. Do not add cloud IDs, revisions,
timestamps, credentials, or storage keys to these fixtures.
