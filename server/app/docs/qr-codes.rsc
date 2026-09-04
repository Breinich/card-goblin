1:"$Sreact.fragment"
2:I[9766,[],""]
3:I[8924,[],""]
4:I[8955,["177","static/chunks/app/layout-d2943bcc63d2318d.js"],"Analytics"]
5:I[2619,["619","static/chunks/619-ba102abea3e3d0e4.js","508","static/chunks/app/docs/%5Bslug%5D/page-98c22dca450172ee.js"],""]
6:I[1356,["619","static/chunks/619-ba102abea3e3d0e4.js","356","static/chunks/356-1143d17a0ca27254.js","499","static/chunks/app/docs/layout-ef4c66615edb4d68.js"],"Image"]
7:I[6776,["619","static/chunks/619-ba102abea3e3d0e4.js","356","static/chunks/356-1143d17a0ca27254.js","499","static/chunks/app/docs/layout-ef4c66615edb4d68.js"],"default"]
23:I[7150,[],""]
:HL["/_next/static/media/4473ecc91f70f139-s.p.woff","font",{"crossOrigin":"","type":"font/woff"}]
:HL["/_next/static/media/463dafcda517f24f-s.p.woff","font",{"crossOrigin":"","type":"font/woff"}]
:HL["/_next/static/css/a85a0228f50c72e6.css","style"]
8:Te07,# What is CardGoblin

CardGoblin turns **a small script + a spreadsheet** into **print-at-home cards**.

You describe what a card looks like *once*. Your spreadsheet holds the data — one
row per monster, spell, or item. CardGoblin generates the whole deck from those two
things and re-renders it live as you type.

```
   your script            your spreadsheet
  (what a card is)        (what's on them)
         │                        │
         └────────┬───────────────┘
                  ▼
          the whole deck, live
                  │
                  ▼
             print PDF
```

## Why it works this way

Card design is mostly repetition. Sixty cards that differ only in a name, a number,
and an icon are sixty chances to make a copy-paste mistake in a drawing tool. Writing
the layout once and the *data* separately means:

- **Change the layout, every card follows.** Move the title, and it moves on all 60.
- **Change one number, only its cards follow.** Editing a cell re-renders only the
  cards generated from that row.
- **Mistakes stay local.** A bad cell turns only the cards generated from its row
  into labelled placeholders — it never blanks the deck. This is a design rule, not
  an accident: see
  [Errors and diagnostics](../goblin-script/09-errors.md).

## What you get

- A **language** ([Goblin script](../goblin-script/01-basics.md)) that reads like an outline: indentation
  is structure, `[brackets]` mean "look this up in the data".
- A **spreadsheet** whose columns are declared by your code, so every reference is
  checked as you type — a typo like `[helth]` squiggles immediately.
- A **live preview** of every generated card, and **[PDF export](../export-and-project/01-pdf-export.md)** with
  cut lines and duplex-mirrored backs.
- **Icons** — 888 game glyphs (dice, suits, dominoes, coins) via the
  [Dicier](https://speakthesky.itch.io/typeface-dicier) font.

## Where your work lives

The public editor does not upload your Goblin script, spreadsheet rows, or uploaded
images. Code and rows autosave to this browser's `localStorage`; images added through
the Assets drawer live in IndexedDB; the current compiled preview is held in memory.
See [Autosave](../export-and-project/02-autosave.md) and
[Uploaded assets](../export-and-project/04-assets.md) for the details and limits.

Like any web app, your browser may cache CardGoblin's own app code, fonts, and icons
so pages load efficiently. That ordinary browser cache is not a project backup or a
sync service. Clearing this site's data can erase your local project, so export a
[project file](../export-and-project/03-project-files.md) for anything important.

One exception is artwork you reference by an external `https://` URL: the browser
fetches that image from its host, which receives an ordinary web request. Upload an
image through Assets when you want the artwork itself stored only in this browser.

## Who it's for

Board game designers making print-and-play prototypes, especially decks with
structure — rank × suit, one icon per point of health, a cost that changes a banner's
color. If your deck is 60 cards of the same shape, this pays off fast. If it's 5 cards
of wildly different art, a drawing tool is probably still the better answer.

## Where to go next

- **[Quickstart](02-quickstart.md)** — build a real deck in five minutes.
- **[The editor](03-the-editor.md)** — what the three panels do.
- **[Goblin script basics](../goblin-script/01-basics.md)** — the language from the ground up.9:Ted7,# Quickstart

Opening the editor first asks you to choose or import a project. This page uses the
original Monster sample as a compact tour of the Goblin language; it is documentation,
not an automatically loaded starter. Open [the editor](/editor) alongside, choose a
project, and adapt the examples as you read — everything recompiles about a third of
a second after you stop typing.

## 1. An Enum — a fixed set of options

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors
```

Enums do two jobs: they can **type a spreadsheet column** (its cells become
dropdowns), and they can **drive card generation** via `loop:` — one card per case.

## 2. A Sheet — the spreadsheet's columns

```goblin
Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
```

A `Sheet` declares a tab in the spreadsheet panel and the columns on it. Column types
are `Text`, `Number`, any Enum you declared, or a multi-enum `Set<Enum>`/`List<Enum>`.
**The code owns the columns; you own
the rows.** Add a column here and it appears in the grid; rename one and the data
follows it.

More in [Sheets and data](../goblin-script/02-sheets-and-data.md).

## 3. A Template — what a card looks like

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: if [current_suit] == Suit.Rock then grey
           else if [current_suit] == Suit.Paper then gold
           else mediumpurple
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    color: black
    text: [name]
  Repeat: [health] as i
    Icon:
      x: 1.5 + [i] * 2
      y: 25
      size: 1.8
      color: red
      code: "HEARTS"
```

A template is a drawing: shapes listed top to bottom, later ones drawn on top.

- `[name]` and `[health]` pull from the spreadsheet row of whichever card is being
  drawn.
- `[current_suit]` comes from the Card's `loop:` (below).
- **`Repeat:` is the one to notice.** It draws its children N times — here, one heart
  per point of health, each placed by index math (`[i]` counts 0, 1, 2…). One number
  in a cell becomes a row of hearts.

The demo's full template also has a cost label and a suit icon. A back is just another
template:

```goblin
Template: PlainBack
  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: teal
```

More in [Templates and shapes](../goblin-script/03-templates-and-shapes.md).

## 4. A Card — tie it together

```goblin
Card: Monster
  sheet: Monsters
  size: poker
  x_units: 20
  y_units: auto
  loop: Suit as current_suit
  count: [count]
  Front: MonsterFront
  Back: PlainBack
```

A `Card` block says which sheet feeds it, the physical size, the coordinate grid, and
which templates draw the front and back.

Cards are generated as **rows × loop options × count**. With 2 rows, 3 suits, and
counts of 2 and 1, you get 2 × 3 = 6 distinct faces and 9 physical cards. Omit `loop:`
for one card per row; omit `Back:` for a plain white back.

More in [Cards and generation](../goblin-script/08-cards-and-generation.md).

## 5. Try changing things

Each of these exercises a different part of the pipeline:

| Change | What should happen |
|---|---|
| Set Dragon's `health` to 7 | Every Dragon card grows to 7 hearts |
| Set a `cost` cell to `abc` | That cell flags red; only that row's cards become placeholders |
| Delete the `else mediumpurple` line | A squiggle appears; the preview freezes on the last good render |
| Change `then gold` to `then hotpink` | Paper banners recolor |
| Set Dragon's `count` to 5 | The deck grows from 9 to 18 cards |
| Change `"SWORDS"` to `"D6"` | The icon swaps glyph |

Then hit **Export PDF** in the preview toolbar to get it on paper —
see [PDF export](../export-and-project/01-pdf-export.md).a:T1e75,# The editor

The editor lives at [`/editor`](/editor). It first opens a blocking project
chooser: continue this browser's saved project, create a named project from an
available starter, or load a project file. The chooser has no close action until
a project has opened successfully. After that, the workspace has three panels
and a status bar:

```
┌────────────────────────┬────────────────────────┐
│  CODE                  │  PREVIEW               │
│  your Goblin script,   │  one card, or all of   │
│  squiggles on errors   │  them — front/back     │
├────────────────────────┴────────────────────────┤
│  SPREADSHEET — one tab per Sheet:               │
│  columns from your code, rows from you          │
├─────────────────────────────────────────────────┤
│  9 cards · 0 problems · 0 excluded rows         │
└─────────────────────────────────────────────────┘
```

## Code (top left)

Your Goblin script, in a real code editor (Monaco) with syntax highlighting and
autocomplete. Suggestions appear as you type (or on **Ctrl+Space**) and fit where
your cursor is: your column names inside `[brackets]`, the properties a block
accepts, size presets, [color names](../reference/02-colors.md), enum cases after a `.`, and
[icon codes](../reference/03-icons.md) inside `code:` strings. Inside a `Text` or
`TextBox` string, typing `{` offers color-scope and
[resolved-text alias](../goblin-script/04-text.md#reusing-resolved-text-with-aliases)
helpers; after `{alias:`, the editor offers top-level lets that the compiler knows
can resolve to Text. Suggestions come from your latest compile,
so they keep working while the code is broken mid-edit — the moment a `Sheet:`
declares a column, that column is offered everywhere it's legal. Errors appear as
red squiggles where they happen, and the status bar counts how many.

## Preview (top right)

Your generated cards, live. Toggle **Front/Back** and **Export PDF** from the
toolbar, and pick one of two views with the pair of icon buttons next to them:

- **Single card** (the default) — one card, as large as the panel allows. The
  `‹ 3 / 18 ›` control steps through every card in the project, in the order the
  `Card:` blocks declare them, so the arrows carry you from the end of one deck
  into the start of the next. A line above the card says which deck you're in.
- **Grid** — every card at once, grouped by the `Card:` block that made them, with
  a **zoom** slider for card size. Long decks scroll.

Turn on **Row numbers** in either view to place a high-contrast red badge over the
current card—or every visible grid card—showing the one-based sheet row that
generated it. The setting stays on when you switch views. These badges are preview
aids only and never enter PDF output.

The zoom slider only appears in grid view; in single view the card is already
sized to the panel, so making the panel bigger (drag the divider) is the zoom.

While your code has errors, the preview **freezes on the last good result** and shows
an amber note saying so, instead of flickering or emptying. This is the single most
important behaviour in the editor: you can break your code mid-thought and still see
what you were working on.

## Spreadsheet (bottom)

One tab per `Sheet:` you declare in code. The **columns come from your code**; the
**rows are yours to fill**.

- Enum-typed columns become dropdowns.
- `Set<Enum>` and `List<Enum>` columns become chip editors; Lists also expose
  left/right controls because their order and duplicates are meaningful.
- A cell whose value doesn't fit its column flags **red**.
- A brand-new, never-edited empty row renders **dimmed** and is excluded from the deck
  until you type into it — so adding a row doesn't spray errors before you can fill it
  in.
- Your data survives schema edits. Rename a column in code (same position, same type)
  and its data comes with it.
- **Sheets can be renamed from the tab bar.** Select a tab and use **Rename**, or
  double-click the tab. CardGoblin updates the `Sheet:` declaration and every
  `Card`'s `sheet:` reference as one edit while preserving the rows. Renaming is
  disabled while the code is broken, and invalid names or collisions are rejected
  without changing the project.
- **Columns are resizable.** Drag the right edge of a column header, or focus its
  resize handle and use the left/right arrow keys. Turn on **Wrap text** in the tab
  bar when you want long Text cells (such as card descriptions) to wrap and grow
  their rows vertically. Number and enum cells stay single-line, and turning wrapping
  off returns Text cells to the compact single-line view without changing their data.
- **The row number is editable.** Click it and type a new position — the row moves
  there and every row between shifts to make room (typing `2` on row 10 of A..J
  yields A J B C D E F G H I; a number ≤ 0 or past the end clamps to the first or last
  row). Typing something that isn't a number, or the row's own current position,
  leaves the grid untouched. This number is exactly what
  [`[row]`](../goblin-script/02-sheets-and-data.md) resolves to inside your templates —
  reordering rows in the grid is how you reorder what your cards print.

## Status bar

Total cards, code problems, flagged cells, and excluded rows — plus a **stale**
indicator when the preview is showing an older render because the current code
doesn't compile. To its right sit the editor's project-lifecycle controls:

- **Assets** — opens the drawer of images uploaded from your machine (see
  [Uploaded assets](../export-and-project/04-assets.md)), with a count badge.
- **Export project** — download the whole project as a portable file. To load
  one back, choose **New / Open Project**, then **Load project file** — see
  [Project files](../export-and-project/03-project-files.md).
- **Export Data** — download one CSV row per generated card, including virtual
  columns — see [Data export](../export-and-project/08-data-export.md).
- **Project name** — shows the active project's editable name. Choose **Rename**
  to edit it, then **Save** or **Cancel**.
- **New / Open Project** — returns to the project chooser. Your current project
  remains active unless another project finishes opening.

Sign-in and sign-out are not editor controls. Administrator authentication lives
on `/admin`.

## The compile loop

Everything recompiles about **300 ms** after you stop typing. One pass does the whole
pipeline:

```
your code ──► parse ──► check ──► generate ──► preview
your rows ──────────────────────────┘
```

Two rules make it feel stable rather than twitchy:

- **Keep last good.** The preview shows the last render that succeeded; the grid's
  tabs and columns come from the last schema that compiled. Neither flickers while
  you're halfway through typing a block.
- **Per-card isolation.** A data problem affects only the cards that touch it. The
  rest of the deck renders normally.

## Saving your work

The editor [autosaves](../export-and-project/02-autosave.md) your code and rows to this browser and restores
them when you come back — one save slot, one browser. For anything precious, export
a [project file](../export-and-project/03-project-files.md) too — it's a proper backup that travels.b:Td0b,# Basics & syntax

Goblin script is an outline language: what's indented under something belongs to it.
There are four kinds of named top-level block — `Enum`, `Sheet`, `Template`, and
`Card` — plus global `let` values. They can appear in any order (forward references
work).

## Indentation is structure

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    color: teal
```

The `Rectangle` belongs to the template; `x` and `color` belong to the rectangle. Use
spaces or tabs, but be consistent within a file.

## Comments

`#` starts a comment that runs to the end of the line.

```goblin
# the monster deck — suits come from the loop
Enum: Suit
  case Rock     # beats scissors
```

**One quirk:** `#` followed by exactly six hex digits is a *color*, not a comment
(`#ff0000`). Don't start a comment with something like `#ff0000`.

## Names

Declared names — `Suit`, `Monsters`, `MonsterFront` — are plain words: a letter,
then letters, digits, or underscores. No quotes.

A small set of words is reserved and can't be used as names: the block openers
(`Enum` `Sheet` `Template` `Card` `Rectangle` `Text` `TextBox` `Icon` `Image`
`Qr` `Repeat` `Front` `Back`), the declaration words (`case` `column`), and the
expression words (`if` `then` `else` `and` `or` `not` `as`).

Everything else is fair game. Property words like `count`, `size`, `color`, and `full`
are ordinary identifiers — so `column count: Number` is perfectly legal, and `[count]`
reads that column. Meaning comes from position, and `[brackets]` always mean a data
reference.

Several newer forms are contextual, not reserved names: `let` is special only in
`let name: value`, `param` only in `param name: Type` directly inside a Template,
`virtual` only in `virtual column name: Type = expression` inside a Sheet, and
capitalized `If:`/`Else:` and `ForEach:` only where a Template node can appear.
`Set<Enum>`/`List<Enum>` are special only in type positions, and `contains(...)`
only in expression position. `column let: Text`,
`column param: Text`, `column virtual: Text`, `Template: If`, and `Front: If` are
therefore still legal.

## Labels

The quoted string after a shape is an optional **label**, purely for your own
readability. It's never referenced by anything:

```goblin
Rectangle: "Banner"      # labelled
Rectangle:               # unlabelled — identical behaviour
```

## Values can span lines

A property's value may continue onto following lines as long as they're indented
deeper than the property name:

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

This works for property lines (including explicit Template call arguments) and
`let name:` initializers. Block headers like
`Repeat:` and `If:` never continue — their indented lines are children, so their
expressions have to fit on one line.

## Data references

Square brackets always mean *look this value up*:

```goblin
text: [name]
x: 1.5 + [i] * 2
text: "Cost: [cost]"     # interpolated inside a string
text: "Card [card:03]"   # Number zero-padded to a minimum width of 3
```

Where those values come from is [Sheets and data](02-sheets-and-data.md), including the
Number-only `[name:0N]` interpolation format. To write a literal `[` inside a string,
double it: `[[`.c:T264a,# Sheets & data

Your code declares the **shape** of the data; the grid holds the **values**. That
split is what makes every `[reference]` checkable as you type.

## Declaring a sheet

```goblin
Sheet: Monsters
  column name: Text
  column cost: Number
  column health: Number
  column count: Number
```

Each `Sheet:` becomes one tab in the spreadsheet panel with exactly these columns.
Column types are:

| Type | Cells accept | Empty cell |
|---|---|---|
| `Text` | anything | treated as `""` |
| `Number` | numeric values | an error if referenced |
| *any Enum* | one of that enum's cases (dropdown) | an error if referenced |
| `Set<Enum>` | zero or more unique cases (tag chips) | valid empty set |
| `List<Enum>` | zero or more ordered cases; duplicates allowed | valid empty list |

A sheet may declare **zero columns** — the tab then just holds numbered rows. That's
the idiom for decks whose content comes entirely from a `loop:`.

### Editing the schema

- Add a `column` line → the column appears in the grid.
- Remove one → the column disappears, but **its data is kept for the session**, in
  case you were mid-typo.
- Rename one (same position, same type) → the data **migrates** with it. Rename the
  column and its `[references]` together and nothing is lost.

## Enums

```goblin
Enum: Suit
  case Rock
  case Paper
  case Scissors
```

An enum is a named, fixed set of cases. Two uses:

1. **As a column type** — `column suit: Suit` makes those cells dropdowns, so a cell
   can never hold a value the code doesn't know about.
2. **As a generator** — `loop: Suit as current_suit` on a Card produces one card per
   case. See [Cards and generation](08-cards-and-generation.md).

Refer to a case as `Suit.Rock`. Bare `Rock` also works wherever the expected type
makes it unambiguous — comparing against an enum-typed reference, for instance.

## Sets and lists

Use a Set for unordered game tags whose display order should stay consistent, and a
List for a symbol sequence whose order and repetitions matter:

```goblin
Enum: CardTag
  case Armor
  case Fire

Enum: Mana
  case Generic4
  case Blue
  case Red

Sheet: Cards
  column tags: Set<CardTag>
  column cost: List<Mana>
```

A Set cell never contains the same case twice and displays/iterates in the Enum's
declaration order. A List preserves the cell order, so `Blue, Blue, Generic4` is
three entries. The grid presents both as chips; comma-separated text is their
clipboard/export representation. Spaces around names are ignored. Unknown cases,
empty entries such as `Blue,,Red`, and duplicates in a Set flag that cell red while
preserving what was pasted. Reordering an Enum changes a Set's semantic display and
iteration order but never silently rewrites stored rows.

Use `contains([tags], CardTag.Fire)` to test membership and `ForEach` to draw every
member. Collections do not turn into Text automatically and cannot be compared.

## How `[references]` resolve

Inside a template, `[name]` is looked up in this order, innermost first:

1. the nearest enclosing **`Repeat`/`ForEach` variables** and local **`let` values**,
   nearest scope first,
2. the current Template's **parameters**,
3. the Card's **`loop` variables**,
4. the bound **sheet's columns**,
5. global **`let` values**,
6. the built-in **generation bindings** (below).

```goblin
Card: Monster
  sheet: Monsters              # sheet columns: [name], [cost], [health], [count]
  loop: Suit as current_suit   # Card loop variable: [current_suit]
  ...

Template: MonsterFront
  Repeat: [health] as i        # nearest local binding: [i]
    Icon:
      x: 1.5 + [i] * 2
```

Templates are checked **per Card that reaches them**, including through Template
calls, so a template referencing
`[health]` is valid when used by a Card whose sheet has a `health` column, and
squiggled when used by one that doesn't. A shadowed name (a `Repeat` variable with the
same name as a column) still works, innermost-first, but warns.

## Generation identity: row, copy, deck, and project

These derived bindings are available anywhere a Card context exists, including
Templates, `count:`, program lets, and virtual columns — no sheet column to declare:

- **`[row]`** — the row's 1-based position in its sheet. It's exactly the number
  shown (and edited — see [The editor](../getting-started/03-the-editor.md)) in the
  grid's row gutter, so every card generated from one row shares it.
- **`[card]`** — the card's 1-based position within its *generated deck*, counting
  every `loop:` combination and `count:` copy. It increments once per physical card.
- **`[copy]`** — the 1-based copy within the current row × loop combination. It
  resets to 1 for the next combination.
- **`[deck]`** — Text containing the current `Card:` declaration name, such as
  `BlackCards` or `WhiteCards`.
- **`[deck_card]`** — a clearer alias for `[card]`; both always produce the same Number.
- **`[project_card]`** — the 1-based physical position across all generated `Card:`
  blocks in declaration order.

They only differ once `loop:` or `count:` turns one row into several cards. Two rows
(Dragon, Imp) times the demo's three suits:

| Sheet row | Suit | `[row]` | `[card]` |
|---|---|---|---|
| Dragon | Rock | 1 | 1 |
| Dragon | Paper | 1 | 2 |
| Dragon | Scissors | 1 | 3 |
| Imp | Rock | 2 | 4 |
| Imp | Paper | 2 | 5 |
| Imp | Scissors | 2 | 6 |

`[row]` labels the *data*. `[copy]` distinguishes duplicates of one row/loop result.
`[deck]` says which Card declaration emitted the instance. `[card]`/`[deck_card]`
number one deck, while `[project_card]` numbers the current generated project.

### Choosing a durable ID

Position numbers change when you reorder rows or Card declarations, add loop cases, or
change counts. That makes `[project_card]` useful for a particular print manifest, but
not a durable identity. Prefer a semantic code stored in your sheet and add the variant
and copy when duplicates must be distinct:

```goblin
text: "[edition]|[code]|[copy]"       # durable while those meanings stay stable
text: "[deck]|[deck_card]|[code]"     # explicit, but deck-position dependent
text: "[project_card]|[code]"         # unique in this generated project only
```

If you need an ID that survives sheet reordering, store it in a column such as `code`.
`[row]` is a visible position, not a hidden persistent row UUID.

All generation bindings are derived, not stored: nothing about them lives in your rows,
your autosave, or an exported [project file](../export-and-project/03-project-files.md) —
moving a row in the grid is what changes what `[row]` (and, downstream, `[card]`)
resolve to for it.
If a sheet declares a column with one of these names, that column **shadows** the
built-in of the same name for any Card bound to it (with the usual shadowing warning)
— existing projects that already used those names keep working unchanged.

## Interpolation

Inside a string, `[ref]` substitutes the value:

```goblin
text: "Cost: [cost]"      # → "Cost: 5"
```

Numbers and enum cases become text automatically here (trailing zeros are trimmed;
an enum prints its case name). Use `[[` to write a literal opening bracket.

### Reusable text inside a cell

Cell contents are values, not Goblin source, so a cell containing `[damage_icon]`
is not interpolated a second time. `Text` and `TextBox` have one purpose-built way
to place a shared marker-rich fragment anywhere inside cell text: put the fragment
in a top-level Text-valued let and write `{alias:damage_icon}` in the cell. Alias
expansion happens after `text: [column]` resolves and before inline asset, icon, and
color markers are parsed. See the complete
[damage-and-swords example](04-text.md#reusing-resolved-text-with-aliases), including
one-level expansion and D011 failure behavior.

### Zero-padding Number references

Inside a quoted string, write `[name:0N]` to pad a Number with zeroes to a minimum
width. `N` is a decimal width from 1 through 64, written without a leading zero:
`01`, `04`, and `064` are valid formats; `00`, `001`, and `065` are not.

```goblin
text: "[deck]-[deck_card:03]"  # BlackCards-007

let shifted_id: [project_card] + 100
text: "CG-[shifted_id:06]"     # CG-000107
```

The width includes a minus sign, and zeroes follow that sign: `-7` with `:04` becomes
`-007`. Width is only a minimum. A longer value is never truncated, and a fractional
value is never rounded (`1.25` with `:06` becomes `001.25`).

This format is Number-only and string-only. A Text or enum reference with `:0N` is a
type error, and `[name:04]` cannot be used as a standalone expression. Ordinary
`[name]` interpolation works exactly as before.

## Rows

Rows live in the grid, not in your code — editing a cell never rewrites your script.
Two rules worth knowing:

- **Pristine rows are excluded.** A row you just added and haven't typed in is dimmed
  and left out of the deck. It joins as soon as you type into it.
- **Bad cells are local.** A cell that doesn't fit its column flags red, and only the
  cards built from that row become placeholders. See
  [Errors and diagnostics](09-errors.md).

## Virtual columns

Use `virtual column name: Type = expression` inside a `Sheet:` when an exported
print manifest needs a computed value that users should not edit. Virtual columns
do not appear in the grid or row storage; they are evaluated for each generated card
and included by [Export Data](../export-and-project/08-data-export.md). Because they run
in the Card context, formulas can use ordinary columns, loop variables, every
generation binding (`[row]`, `[copy]`, `[deck]`, `[deck_card]`, `[card]`, and
`[project_card]`), and program `let` bindings.

```goblin
Sheet: Monsters
  column code: Text
  virtual column card_code: Text = "[card]|[code]"
```d:T2ff1,# Templates & shapes

A `Template:` is a named drawing — a list of shapes rendered in the order you write
them, so **later shapes draw on top**.

```goblin
Template: MonsterFront
  Rectangle: "Banner"
    x: 0
    y: 0
    width: full
    height: 3
    color: teal
  Text: "Title"
    x: middle
    y: 0.7
    size: 1.6
    text: [name]
```

A Template still gets sheet columns, Card loops, global lets, and generation built-ins
from whichever Card reaches it. It can also declare typed parameters when a caller must
choose a layout or style explicitly.

## Template parameters

Declare required parameters directly inside the Template with
`param name: Type`. The type may be `Text`, `Number`, `Bool`, `Color`, or an enum.
Declarations may appear anywhere among the Template's direct children and are hoisted
across its whole body. Parameters are immutable; they cannot be declared inside an
`If`, `Else`, or `Repeat`.

```goblin
Enum: CardEdition
  case Black
  case White

Template: MonsterFront
  param edition: CardEdition

  let background: if [edition] == CardEdition.Black
    then #000000
    else #FFFFFF

  Rectangle:
    x: 0
    y: 0
    width: full
    height: full
    color: [background]
```

Supply arguments beneath `Front:` or `Back:`. Each argument is an expression evaluated
in the Card caller's scope:

```goblin
Card: BlackCards
  # sheet, size, units, count...
  Front: MonsterFront
    edition: CardEdition.Black

Card: WhiteCards
  # same data and layout, different count/style choice
  Front: MonsterFront
    edition: CardEdition.White
```

Every declared parameter is required. Missing, extra, duplicate, or wrongly typed
arguments are compile errors.

## Reusing Templates

A Template can call another Template by writing its name as a node header:

```goblin
Template: Frame
  param edition: CardEdition
  # draw the edition-specific frame...

Template: MonsterFront
  param edition: CardEdition

  Frame:
    edition: [edition]
  If: [elite]
    EliteBadge:
```

The called shapes are inserted at that exact position, so source order still controls
which shapes draw on top. Calls may be nested and may sit inside `If`, `Else`, or
`Repeat`. Arguments use the same indented form as Card faces.

A called Template deliberately does not capture the caller's parameters, local `let`
values, or `Repeat` index. Argument expressions *do* run in caller scope, so forwarding
is explicit: `edition: [edition]` above passes the outer parameter to `Frame`. The
callee then sees its own parameters and locals plus global lets, Card loops, sheet
columns, and generation built-ins. This keeps a Template's inputs readable at the call
site instead of making nested composition depend on hidden caller state.

For compatibility, a Template may still literally be named `If` or `Else` and used
as `Front: If` or `Back: Else`. Those two names cannot use nested-call shorthand,
because `If:` and `Else:` are structural there.

## Drawing conditionally

```goblin
If: [equipment]
  EquipmentFrontRotated:
Else:
  EquipmentFront:
```

`If:` takes a one-line Bool expression. `Else:` is optional and must be the next
nonblank, non-comment sibling at the same indentation. Both branches are checked; only the
selected branch runs, so an unselected branch emits no shapes, reads no lets, and
produces no data errors. Branches have their own local scope. For else-if, nest an
`If:` inside `Else:`.

## Local values

Use `let name: expression` anywhere a Template node can appear, including inside
`If`, `Else`, and `Repeat`. A local let is immutable, visible throughout its lexical
block even before its declaration, and newly evaluated for each Template call,
selected branch, or Repeat iteration. A callee cannot see it unless the caller passes
it as an explicit argument.

## The coordinate grid

Cards use an abstract unit grid, so a layout survives a change of card size and still
prints at exact millimetres.

```goblin
Card: Monster
  size: poker      # 63.5 × 88.9 mm
  x_units: 20      # → 1 unit = 63.5/20 = 3.175 mm
  y_units: auto    # → 28 units tall, units stay square
```

- **`size:`** picks the physical card — see [Card sizes](../reference/01-card-sizes.md).
- **`x_units: N`** slices the card's *width* into N units. One unit = width ÷ N.
- **`y_units: auto`** keeps units square and derives the vertical count. A poker card
  at 20 wide is exactly 28 tall. You *can* force an integer instead, which stretches
  units out of square — you'll get a warning.
- **`full`** means the whole axis and **`half`** means half of it, so `width: full`
  spans the card.

Because units are square under `auto`, a shape that's 2 × 2 units is actually square
on paper. That's what `width: full` in the template above means: the banner spans the
card, whatever size the card turns out to be.

## The shapes

| Shape | Required | Optional (default) | Notes |
|---|---|---|---|
| `Rectangle` | `x y width height color` | `pivot` (top_left), `rotate` (0) | a filled box |
| `Text` | `x y size text` | `color` (black), `font` (geist), `pivot` (top_left), `rotate` (0) | one line; `size` is text height in units — see [Text & TextBox](04-text.md) |
| `TextBox` | `x y width height text size` | `color` (black), `font` (geist), `align` (left), `line_height` (1.3), `overflow` (clip), `pivot` (top_left), `rotate` (0) | wrapped multi-line text in a box — see [Text & TextBox](04-text.md) |
| `Icon` | `x y size code` | `color` (black), `pivot` (top_left), `style` (flat_dark), `rotate` (0) | a game glyph — see [Icons](../reference/03-icons.md) |
| `Image` | `x y width height src` | `fit` (contain), `color` (white/unchanged), `pivot` (top_left), `rotate` (0) | your own artwork with optional multiply tint — see [Images](05-images.md) |
| `Qr` | `x y size data` | `color` (black), `background` (white), `level` (m), `pivot` (top_left), `rotate` (0) | a scannable QR code — see [QR codes](06-qr-codes.md) |
| `Repeat: N as i` | — | — | draws its children N times — see below |

## Pivots — which point of the shape `x`/`y` place

Every shape takes an optional `pivot:` naming **which point of the shape
itself** its `x`/`y` coordinates refer to — the shape's own handle, not a
point on the card. Nine points, spelled with underscores, vertical word
first:

| `pivot:` | The point `x`/`y` place |
|---|---|
| `top_left` | top-left corner — **the default** |
| `top_center` | middle of the top edge |
| `top_right` | top-right corner |
| `center_left` | middle of the left edge |
| `center_center` | dead center |
| `center_right` | middle of the right edge |
| `bottom_left` | bottom-left corner |
| `bottom_center` | middle of the bottom edge |
| `bottom_right` | bottom-right corner |

**To center a shape on the card**, pair the halfway coordinate with the
halfway pivot — reach for this any time you want something centered:

```goblin
x: half
y: half
pivot: center_center
```

`half` puts `x`/`y` at the card's own midpoint; `pivot: center_center` says
that midpoint is the shape's OWN center too — so the shape's center lands
exactly on the card's center. (`pivot: center_center` with `x: 0, y: 0` does
something different, and it trips people up: it puts the shape's center on
the card's top-left CORNER — correct once you know `x`/`y` is always a point
on the card that the shape's own center gets placed at, but a common surprise
if you expected it to pin a corner of the CARD instead.)

So `pivot: bottom_right` with `x: full` and `y: full` pins a shape to the
card's bottom-right corner.

Spelling conveniences:

- **Either word order works** — `center_bottom` and `bottom_center` are the
  same point.
- Plain `center` is shorthand for `center_center`.
- The original Text/Icon values `left`, `middle`, and `right` still work as
  aliases for the top row (`top_left`, `top_center`, `top_right`), so existing
  cards mean exactly what they always meant.

What the pivot moves, per shape:

- On **Rectangle, Image, TextBox, and Qr** the pivot moves the whole box:
  `pivot: bottom_right` means `x`/`y` are the box's bottom-right corner.
  Inside a TextBox, `align:` still lays each line within the box's width —
  `align` places text *in* the box, `pivot` places the box *on the card*.
- On **Text and Icon** the pivot applies to the drawn line itself:
  horizontally it sets where the text starts, centers, or ends; vertically,
  `y` names the top, middle, or bottom of the text's height (`size:`). The
  default `top_left` is exactly the old behavior — `y` is the top of the line.
- On an **Image with an `auto` dimension**, the pivot offsets the box the art
  actually resolves to. Until the image loads, the placeholder is a square, so
  a pivoted `auto` box can shift once the true ratio arrives — that's the
  same load-time rule `auto` itself follows.

`x: middle` is still shorthand for "horizontally centered" (Text and Icon only —
`y: middle` is an error, and so is `x: middle` on Rectangle, Image, TextBox, or Qr).
It always wins horizontally, and a written `pivot:` keeps its vertical say:
`x: middle` + `pivot: bottom_left` centers horizontally and pivots the
bottom of the line.

## Rotation — turning a shape on its pivot

Every shape also takes an optional `rotate:` — an angle in **degrees,
clockwise**, and like any other number it can come from data or arithmetic.
The shape turns **around its pivot point**: `x`/`y` stay planted, and the
shape swings around them. That's why the two properties pair so naturally —
the pivot names the shape's handle, and `rotate:` turns it on that handle.

To spin a shape in place, pivot it on its own center:

```goblin
Icon: "Compass"
  x: half
  y: half
  size: 4
  code: "STARS"
  pivot: center_center
  rotate: 45
```

With the default `top_left` pivot, the shape swings around its top-left
corner instead — sometimes exactly what you want, often a surprise. If a
rotation lands somewhere unexpected, check the pivot first.

Because the angle is ordinary arithmetic, `Repeat` makes fans and dials for
free — each copy at its own angle, all sharing one pivot point:

```goblin
Repeat: 5 as i
  Rectangle: "Fan blade"
    x: half
    y: full
    width: 1
    height: 6
    color: teal
    pivot: bottom_center
    rotate: [i] * 15 - 30
```

Rotation changes how a shape is **painted, nothing more**: a rotated
`TextBox` still wraps against its unrotated width, and the
[exported PDF](../export-and-project/01-pdf-export.md) shows exactly what the preview shows. Angles
outside 0–360 work the obvious way — `rotate: -90` is a quarter-turn
counter-clockwise, the same as `270`.

## `Repeat` — numeric repetition

```goblin
Repeat: [health] as i
  Icon:
    x: 1.5 + [i] * 2
    y: 25
    size: 1.8
    color: red
    code: "HEARTS"
```

`Repeat` draws its children N times, with `[i]` counting **0, 1, 2…**. There's no
layout engine — you position copies with arithmetic, which means rows, columns, grids,
and arcs are all just math on `[i]`.

- The count can come from data (`Repeat: [health] as i`) or be computed.
- Repeats nest freely — a grid is a repeat inside a repeat.
- The count expression must fit on **one line**.
- Cap: **500 Repeat/ForEach iterations per card**. Every iteration of either form
  counts once against the same budget, including outer and inner iterations in
  nested repeats — it is not a count of the shapes eventually drawn. Crossing
  the cap produces D004 and makes that affected card an error placeholder; it
  does not keep partially truncated artwork.

## `ForEach` — collection members

`ForEach` draws its children once for every member of a `Set<Enum>` or `List<Enum>`.
The first binding is the enum value; the second is its zero-based position:

```goblin
ForEach: [cost] as symbol, i
  Image:
    x: 2 + [i] * 3
    y: 2
    width: 2.5
    height: 2.5
    src: "asset:mana_[symbol]"
```

Sets iterate in Enum declaration order. Lists preserve their cell order and repeat
duplicate entries. Empty collections draw nothing. `ForEach` nests with itself and
`Repeat`; all iterations share the same 500-per-card safety budget. The header must
fit on one line. As with Template calls from inside `Repeat`, pass an item or index
as an explicit Template argument when a called Template needs it.e:T2f71,# Text & TextBox

Two elements put words on a card: `Text` for one line, `TextBox` when it needs to
wrap inside a box.

## `Text` — one line

```goblin
Text: "Title"
  x: middle
  y: 0.7
  size: 1.6
  text: [name]
```

`x y size text` are required; `color` (default `black`), `pivot` (default
`top_left`), and `rotate` (default `0`) are optional. `Text` always draws a single line — `size` is the text's
height in units, not a font-size number. However long the resolved text is, it
keeps going in one line rather than wrapping; when it needs to fill an area
instead, that's `TextBox`, below. A newline character in the resolved text (from
cell data, say) renders as a space in `Text` — hard breaks are a `TextBox`
feature.

`pivot:` follows the same nine-point vocabulary every shape uses, and
`rotate:` turns the line around that pivot point, in degrees clockwise — see
[Pivots](03-templates-and-shapes.md) on Templates & shapes.

`font:` picks the typeface — `geist` (the default) or one of eight bundled serif
and monospace faces. See [Fonts](#fonts) below for the full list.

## `TextBox` — wrapped, multi-line text

`Text` draws one line, always. When a description, a rules paragraph, or flavor
text needs to *fill an area*, that's `TextBox`:

```goblin
TextBox: "Rules"
  x: 2
  y: 14
  width: 16
  height: 8
  size: 1.1
  text: [rules]
```

`width:` and `height:` declare a box; the text wraps to fit the width, breaking at
spaces. A single word wider than the box breaks mid-word rather than poke out the
side. The wrapping happens **at generation time, in the compiler** — the preview
and the [exported PDF](../export-and-project/01-pdf-export.md) show the exact same line breaks, always.

- `align: left | middle | right` places each line within the box's width
  (default `left`). It's independent of `pivot:`, which moves the box itself —
  and `x: middle` is an error on TextBox, same as on Rectangle.
- `line_height:` is a multiplier on `size` for the distance between baselines.
  The default is **1.3** × size; it must be a plain positive number, not an
  expression.
- `font:` picks the typeface — see [Fonts](#fonts) below. Because wrapping
  measures actual letterforms, the SAME text in the SAME box can wrap onto a
  different number of lines depending on `font:`.
- `rotate:` (default `0`) turns the whole box around its pivot point, in
  degrees clockwise — see [Rotation](03-templates-and-shapes.md) on Templates &
  shapes. It's paint-only: the text wraps against the box's unrotated width,
  exactly as if the box weren't rotated.

### Line breaks you write yourself

Wrapping is automatic, but you can also break lines exactly where you want —
a **hard break** happens wherever a real newline character appears in the text:

- In a string literal, write `\n`:

  ```goblin
  text: "Costs [cost].\n\nDiscard after use."
  ```

  `\n` and `\\` (a literal backslash) are the **only** backslash escapes — any
  other `\`-sequence is an error that names the two valid ones.

- Straight from a cell: if a spreadsheet cell contains newline characters
  (pasted or [imported](../export-and-project/03-project-files.md) multi-line content), those break lines
  too. No escaping involved — the newline is data.

Hard breaks always win: they apply before wrapping, and two in a row make an
empty line. In single-line `Text`, newline characters render as **spaces** —
hard breaks belong to `TextBox`.

### When the text doesn't fit

Wrapping handles width. If the wrapped text is too **tall** for the box,
`overflow:` decides what happens:

| `overflow` | What it does |
|---|---|
| `clip` | keep the declared size, drop the lines that don't fit — **the default** |
| `shrink` | reduce the text size in 5% steps until everything fits, down to a floor of **60%** of the declared size — then clip at the floor |

Neither is an error — a long description is data, not a mistake. But the preview
tells you: a card whose text was clipped or shrunk gets a small **amber dot** in
its top-right corner, so an overflowing box can't slip through to print
unnoticed. Fixing it is a design choice: a bigger box, a smaller `size:`, a
tighter `line_height:`, `overflow: shrink`, or shorter text.

The element's `color:` sets the whole box at once. For differently colored words
inside it, use a scoped color below. Interpolation (`text: "[name]: [rules]"`)
substitutes before wrapping, so mixed cell data wraps as one paragraph. Icons can
sit inline in the text too; bold and italic runs are still a
[roadmap](../export-and-project/06-roadmap.md) topic.

## Reusing resolved text with aliases

When the same marker-rich fragment belongs in several sheet cells, put it in a
top-level Text-valued `let` and insert it with `{alias:name}`:

```goblin
let damage_icon: "{color:#cc2222}{asset:swords}{/color}"

Sheet: Attacks
  column desc: Text

Template: Front
  TextBox: "Rules"
    x: 2
    y: 14
    width: 16
    height: 4
    size: 1.1
    text: [desc]
```

Then type this in one `desc` spreadsheet cell:

```text
Deal 2 {alias:damage_icon}.
```

Aliases are part of **resolved text**, not string interpolation. After the
`text:` expression has resolved, each alias can expand a program-level
`let name:` that successfully resolves to Text for that card. `name` follows the
ordinary declaration-name rules: a letter, then letters, digits, or underscores.
The same syntax therefore works when `{alias:damage_icon}` comes from a
spreadsheet cell. Ordinary
`[damage_icon]` interpolation cannot do this arbitrary placement: interpolation
is parsed in source strings, not by rescanning the contents of a cell.

Expansion happens **exactly one level**, and then the ordinary scoped-color,
Dicier, and asset markers are parsed. Those markers can live inside the let's
value, but another `{alias:other}` produced by that value is not expanded and
stays visible as raw text. Local lets and Template parameters are not alias
targets. `{{alias:name}` writes the literal text `{alias:name}`, following the
same doubled-brace escape as other markers.

An unknown name, a top-level let whose static type is not Text, or a binding the
compiler could not prepare as a valid alias target leaves the original
`{alias:name}` visible. It reports the non-fatal data diagnostic
[D011](09-errors.md), but the card still renders rather than becoming a placeholder.

D011 is only about finding and preparing the target. Once a binding is a valid
Text alias, evaluating it uses the ordinary data-error rules. For example, if its
value reads an empty required Number cell, that remains D003 and the affected card
becomes a placeholder; it does not turn into raw alias text plus D011.

A top-level let that validly resolves to Text without Card data, or for at least
one declared Card, is externally addressable even when no literal alias marker
appears in code: its name may arrive from cell data. It — and the global lets it
depends on — therefore does not receive the ordinary W002 "never used" warning.
This exemption does not rewrite the cell or add anything to
[Export Data](../export-and-project/08-data-export.md); it only makes the let
available while rendering `Text` and `TextBox`.

## Scoped colors

Both `Text` and `TextBox` can recolor part of their resolved text:

```goblin
TextBox: "Rules"
  x: 2
  y: 14
  width: 16
  height: 8
  size: 1.1
  color: black
  text: "Gain {color:gold}2 treasure{/color}, then take {color:crimson}1 damage{/color}."
```

`{color:red}` starts a scope and `{/color}` ends it. Use any CSS color name or a
six-digit hex value such as `{color:#cc0000}`. Scopes nest; closing an inner scope
restores the outer color, and closing the outermost restores the element's own
`color:`. The tags are paint-only: they occupy no width, do not cause a wrap boundary,
and do not change alignment, `line_height:`, or overflow calculations.

Scopes apply after interpolation, including when the tags arrive from a spreadsheet
cell. They also color Dicier markers and multiply-tint inline asset markers:

```goblin
text: "Pay {color:teal}{HEARTS} {asset:energy}{/color} to activate."
```

Outside a scope, Dicier markers inherit the element's whole-text color and asset art
keeps its original colors. Inside one, a white asset becomes the scoped color while
its transparency and dark detail are preserved. Malformed, unknown-color,
unbalanced, or unclosed tags stay visible as raw text and produce no diagnostic — the
same gentle behavior as other unrecognized brace markers.

## Inline icons

Both `Text` and `TextBox` can draw icons *inside* the text, with brace markers:

```goblin
Text: "Cost"
  x: 1
  y: 1
  size: 1.2
  text: "Pay {HEARTS} or discard {asset:skull}"
```

- `{HEARTS}` draws the [Dicier icon](../reference/03-icons.md) with that code — uppercase
  letters, digits, underscores (and the one code with a space) between braces.
- `{asset:skull}` draws an [uploaded asset](../export-and-project/04-assets.md) by name, exactly the
  names the Assets drawer holds.
- `{{` is a literal `{`. A lone `}` is just a `}`. Anything else in braces —
  lowercase, empty, unclosed — isn't a marker and stays ordinary text, no
  warning.

**Every icon occupies a square one-em slot**: as wide and tall as the text's
`size`, sitting on the line. Dicier icons draw in the current element/scoped
color; asset art keeps its own colors unless enclosed by a color scope, and
letterboxes into the slot if it isn't square. For now inline Dicier icons always use the default `flat_dark` face —
the `style:` choice that [`Icon`](../reference/03-icons.md) has doesn't reach inline markers
yet.

Markers are read from the **resolved** text — after `[column]` interpolation
and one-level [alias expansion](#reusing-resolved-text-with-aliases) — so a
marker can come straight from a spreadsheet cell (`text: [effect]` where the
cell says `Take {1_ON_D6} damage`), and data-driven icons work with no extra
syntax.

In a `TextBox`, a marker wraps like a word: it moves to the next line whole,
never splitting its slot, and the spaces around it collapse at a line break
exactly like word wrap.

Mistakes stay gentle, the same way icon codes and asset names already work:
an unknown Dicier code written literally in the code warns
([W004](09-errors.md)), an unknown asset name warns (W005), and an unknown code
arriving from cell data is noted at generation time (D005) while the marker
renders as its raw text — the failure is its own indicator, and one bad
marker never blanks a card.

## Fonts

Both `Text` and `TextBox` take an optional `font:` — nine bundled faces, picked
by name:

```goblin
Text: "Title"
  x: middle
  y: 0.7
  size: 1.6
  font: garamond_bold
  text: [name]
```

| `font:` | Face |
|---|---|
| `geist` | the app's clean sans-serif — **the default** |
| `garamond` | Cormorant Garamond, an elegant serif — regular |
| `garamond_bold` | Cormorant Garamond — bold |
| `garamond_italic` | Cormorant Garamond — italic |
| `garamond_bold_italic` | Cormorant Garamond — bold italic |
| `courier` | Courier Prime, a typewriter monospace — regular |
| `courier_bold` | Courier Prime — bold |
| `courier_italic` | Courier Prime — italic |
| `courier_bold_italic` | Courier Prime — bold italic |

Like `style:` on [`Icon`](../reference/03-icons.md), this is a **closed list**: an unrecognized
value is an error, not a warning. It's a deliberately small, fixed set for
now — two typefaces bundled with the app, not a general font-upload system —
chosen to cover a serif and a monospace need without opening a whole asset
pipeline. If you need a font that isn't here, that's currently out of reach.

**Wrapping is measured per font.** `TextBox` wraps by measuring each font's own
letterforms, so the SAME text in the SAME box can break onto different lines
depending on `font:` — Courier's fixed-width letters and Cormorant Garamond's
narrower serif shapes don't take up the same room per character. There's
nothing to configure for this; it's why the wrapping stays correct — and the
preview matches the exported PDF exactly — no matter which face a box uses.f:T101c,# Images

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "https://example.com/art/[name].png"
  fit: cover
  color: teal
```

`src:` is a text [expression](07-expressions.md), so the URL can come straight from a
sheet column (`src: [art_url]`) or be built with interpolation, and different rows get
different art.

## Recolor white artwork

Add an optional `color:` to multiply the artwork by a color:

```goblin
Image: "Faction mark"
  x: 2
  y: 2
  width: 4
  height: 4
  src: "asset:faction_mark"
  color: if [faction] == Faction.Sea then teal else crimson
```

The default is `white`, which leaves every pixel unchanged. Multiplication is
especially useful for white PNG/SVG-style artwork: white pixels become the chosen
color, black pixels stay black, and gray pixels keep their shading. Transparent and
partly transparent edges keep their original alpha. This uses the same Color values
as every other `color:` — CSS names or six-digit `#RRGGBB`, including expressions —
and does not add `rgba()` or eight-digit hex.

Tinting happens only after the art loads. Loading and failed-image placeholders keep
their normal gray/amber appearance. Both URL art and uploaded `asset:` art behave the
same way, and the exported PDF uses the exact same multiplied rendering as the
preview.

## The box and the art are two different shapes

`width:` and `height:` declare a **box** on the card — not the drawn size of the
art. The art has its own proportions, and `fit:` says how the two are reconciled
when they don't match:

| `fit:` | What it does |
|---|---|
| `contain` | whole image visible, letterboxed inside the box — **the default** |
| `cover` | box fully covered, overflow cropped |
| `stretch` | image distorted to exactly fill the box |

> **Why didn't my image stretch?** With the default `fit: contain`, `height: 12`
> promises a 12-unit box, **not** 12 units of drawn art. The art keeps its own
> ratio and letterboxes inside the box — a wide image draws shorter than 12,
> centered, with empty space above and below. If you want the art deformed to fill
> the box exactly, that's `fit: stretch`; if you want the box itself to follow the
> art, give one dimension as `auto`.

### `auto` — size the box from the art

Write `auto` for exactly one of `width:`/`height:` and that dimension follows the
art: the other dimension × the image's own ratio. It's the way to say "exactly as
tall as the ratio demands" — no letterboxing, no cropping, no distortion:

```goblin
Image: "Banner"
  x: 0
  y: 0
  width: full
  height: auto     # exactly as tall as the art's ratio makes it
  src: [banner_url]
```

`width: full` + `height: auto` is the idiom for full-bleed banner art at its
natural proportions. A few things to know:

- Exactly **one** of the pair can be `auto` — both is an error, since nothing
  would be left to derive the ratio from.
- The ratio is only known once the image loads, so until then (and if the load
  fails) the box shows as a **square** placeholder.
- `fit:` does nothing next to `auto` — the box already matches the art's ratio,
  so all three modes draw the same picture. Writing it isn't an error; it's just
  inert.

While an image downloads, its box shows a subtle gray placeholder; if the source fails
to load, the box turns into an amber crossed-out placeholder instead. **Neither is a
code or data error** — the rest of the card renders normally, and fixing the source
fixes the box. PDF export has one extra requirement for URL art — see
[PDF export](../export-and-project/01-pdf-export.md).

## Art with no hosting — uploaded assets

`src:` doesn't have to be a URL. Reference an image you've uploaded through the
**Assets** drawer with the `asset:` scheme instead:

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "asset:dragon_art"
```

See [Uploaded assets](../export-and-project/04-assets.md) for the drawer itself, the 2 MB cap, and how
uploads are stored — everything about `src:` being a Text expression still
applies, so `src: [art]` and `src: "asset:[art]"` work exactly like they do with a
URL.10:Tb42,# QR codes

```goblin
Qr:
  x: 2
  y: 2
  size: 6
  data: [code]
```

`data:` is a text [expression](07-expressions.md), so the code can come straight from a
sheet column (`data: [code]`), be interpolated (`data: "https://example.com/[code]"`),
or be computed with a conditional — the usual coercions apply.

## The idiom: one QR per card, on the back

The point of a card's QR is usually to let a companion app scan it and act — a
cross-media game where the app is out of scope for CardGoblin, but the code on the
card is exactly what it needs. Because `Back:` templates evaluate per card just like
`Front:` templates (every card sees its own row's data), a `Back:` template needs
nothing extra to give every card in the deck a different code:

```goblin
Qr:
  x: 2
  y: 2
  size: 16
  data: [code]
```

Those four lines — `x y size data` — are the whole idiom: a Text column of codes in
your sheet, one `Qr:` block in a `Back:` template, and every card's back carries its
own scannable code.

## `level:` — error correction

QR codes carry redundant data on purpose, so a code still scans even partly
obscured, scratched, or printed small. `level:` picks how much:

| `level:` | What it does |
|---|---|
| `l` | roughly 7% of the code can be damaged and it still scans |
| `m` | roughly 15% — **the default** |
| `q` | roughly 25% |
| `h` | roughly 30% — the most damage-tolerant, at the densest code for the same data |

A higher level may need a bigger code for larger payloads (more of the code's
capacity goes to redundancy instead of your content, so less room is left for
`data:` at a given size) — a short code (a plain URL, a short id) is often the same
size at every level, but the difference shows up once the content pushes against a
level's capacity. Worth raising for a code that'll be printed small or handled
roughly, and safe to leave at the default otherwise.

## The quiet zone lives inside the box

Every QR code needs a plain border — the **quiet zone** — around the modules for a
scanner to find it. `size:` is the side of the box you declare, and the quiet zone is
drawn **inside** it, in `background:`, so an adjacent shape can never crowd a code's
scan margin just by sitting close on the card. The box you draw is exactly the box a
scanner sees.

## When the data doesn't fit

Every QR code has a capacity ceiling, set by `level:` (higher levels hold less
content at a given size) — a code has a limit past which no code can be built at all,
no matter how large. `data:` that exceeds it is a **QR data is too long for one
code** error, and the card renders as a placeholder, the same "this one card's data
was the problem" isolation every other data-time error gets — the rest of the deck is
unaffected. An empty `data:` is not this case: it encodes as a normal, valid, tiny
code — there's nothing special about zero-length data.11:T13f7,# Expressions

Anywhere a value goes, an expression can go. `x: 4` and `x: 1.5 + [i] * 2` are the
same kind of thing.

| Kind | Examples |
|---|---|
| Arithmetic | `[cost] + 1`, `2 * [i]`, `[atk] % 3`, parentheses |
| Comparison | `==` `!=` on matching types; `<` `<=` `>` `>=` on numbers only |
| Logic | `and`, `or`, `not` |
| Conditional | `if [cost] > 3 then gold else grey` |
| Enum cases | `Suit.Rock` always; bare `Rock` when it's unambiguous |
| Collection membership | `contains([tags], CardTag.Fire)` |

## Conditionals

`if … then … else …` is an *expression*, not a statement — it produces a value, so
`else` is always required:

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

Chain as many `else if`s as you like. Both branches must produce the same type — you
can't return a color from one and a number from the other.

To conditionally draw whole shapes, use capitalized structural `If:`/`Else:` instead:

```goblin
If: [is_rare]
  Text:
    text: "Rare"
Else:
  CommonBadge:
```

`Else:` is optional and must immediately follow its `If:` at the same indentation.
Both branches are checked, but only the selected branch runs; the other produces no
shapes or data errors. Put a nested `If:` inside `Else:` for else-if.

## Named values with `let`

```goblin
let accent: #cc0000

Template: CardFront
  let title_size: 3.5
  Text:
    x: 0
    y: 0
    color: [accent]
    size: [title_size]
    text: "Title"
```

A `let` is immutable and type-inferred. Global lets can use the current Card's data;
local lets can use their lexical parents. Same-block lets may refer forward. Values
are lazy, so an unused let and a let in an unselected branch do not read cells or
produce data errors. Use a self-typing color (`#RRGGBB`) or qualified enum case
(`Suit.Rock`) when no surrounding property supplies an expected type.

A top-level let that resolves to Text can also be inserted into `Text` or `TextBox`
resolved text with `{alias:name}`. This is a one-level reuse mechanism for fragments
that contain [inline icons, assets, or scoped colors](04-text.md#reusing-resolved-text-with-aliases),
not another expression lookup: local lets, parameters, non-Text lets, and unknown
or statically invalid/unpreparable targets are left as the raw marker with a
non-fatal D011 data diagnostic. Runtime data errors from an otherwise valid Text
alias propagate exactly as they do for an ordinary let reference; D003, for example,
still makes the affected card a placeholder. Because an alias name can arrive from
a spreadsheet cell, a top-level let that validly resolves to Text for at least one
Card (or without Card data), and
the globals it depends on, are externally addressable and do not receive W002
"never used". This compiler-level alias-export status makes the let available to
resolved text and affects unused-binding checks; it does not add the let to
spreadsheet or CSV data exports.

## Types

There are `Number`, `Text`, `Bool`, `Color`, one type per Enum you declare, and
`Set<Enum>`/`List<Enum>` collection types.
Checking happens as you type, so mistakes squiggle rather than producing odd cards:

- arithmetic needs numbers,
- `==` and `!=` need both sides to be the *same* type,
- `<` `<=` `>` `>=` are **numbers only** — there's no meaningful ordering on text or
  enum cases,
- an `if` condition must be a Bool.

`contains(collection, case)` works with both Sets and Lists and produces Bool. The
case must come from the collection's Enum. Collections may pass through `let`,
Template parameters, and same-typed `if` branches, but they cannot be compared or
automatically converted to Text. Collection literals and mutation are not part of
Goblin Script; collection values originate in sheet data.

**Comparisons don't chain.** `a == b == c` is an error — write `a == b and b == c`.

The one automatic conversion: in a text position (`text:`, `code:`, or inside string
interpolation) numbers and enum cases become text. That's what makes `text: [cost]`
work.

Quoted strings have one Number-specific formatting form: `[name:0N]` zero-pads to a
minimum total width `N` from 1 through 64. It includes a minus sign in that width and
never rounds or truncates. See [Interpolation](02-sheets-and-data.md) for examples and
the exact spelling rules. It does not change ordinary `[name]` coercion.

## Bare names

A bare word resolves against whatever type is expected in that position:

- in a `color:` property → a [CSS color name](../reference/02-colors.md),
- compared against an enum-typed reference → that enum's cases,
- in a geometry position → `full`, `half`, `middle`, `auto`.

So an enum case named `gold` never collides with the color `gold` — position decides.
Where no expected type is available, a bare case resolves only if it's unique across
all your enums; otherwise qualify it as `Suit.Rock`.

## Precedence

Lowest to highest:

```
if/then/else  →  or  →  and  →  not  →  comparisons  →  + -  →  * / %  →  unary -
```

Parentheses work as you'd expect.12:Tf38,# Cards & generation

A `Card:` block is a card *type*. It binds a sheet, a physical size, a coordinate
grid, and the templates that draw each face.

```goblin
Card: Monster
  sheet: Monsters              # required — which data feeds it
  size: poker                  # required — the physical card
  x_units: 20                  # required — the coordinate grid width
  y_units: auto                # required — auto keeps units square
  loop: Suit as current_suit   # optional — multiplies the deck
  count: [count]               # optional — copies per card (default 1)
  Front: MonsterFront          # required
    edition: CardEdition.Black # required when MonsterFront declares this param
  Back: PlainBack              # optional — omitted means a plain white back
```

`sheet:`, a physical size, `x_units:`, `y_units:`, and `Front:` are required;
everything else has a default.
Instead of a `size:` preset, a Card may declare an exact `width_mm:` +
`height_mm:` pair — see [custom sizes](../reference/01-card-sizes.md).
Indented lines below `Front:` and `Back:` pass explicit arguments to that Template;
see [Template parameters](03-templates-and-shapes.md).

## How many cards you get

For each Card block:

```
for each non-empty row of the bound sheet
  for each combination of loop cases
    emit `count` copies
```

Those copies are identical unless a face reads a per-instance generation binding such
as [`[copy]`, `[deck_card]`, or `[project_card]`](02-sheets-and-data.md). Then each copy
resolves on its own, since its number is genuinely different content.

So the deck is **rows × loop options × count**. With the demo's two rows, three suits,
and counts of 2 and 1:

- 2 rows × 3 suits = **6 distinct faces**
- 2+2+2 + 1+1+1 = **9 physical cards**

Multiple `loop:` lines nest in declaration order — rows × suits × elements × … Cases
come out in the order you declared them in the enum.

Every card generated this way can reference its row, copy, deck, deck-relative position,
and project-wide position; see [generation identity](02-sheets-and-data.md).

## `count:`

`count:` is an expression, so it can come from data (`count: [count]`) or be computed
(`count: if [rare] then 1 else 3`). It must evaluate to a whole number of at least 0 —
a `0` simply produces no cards for that row.

All generation built-ins are legal in `count:`. Because copies do not exist yet, count
uses the prospective first copy of that row × loop combination: `[copy]` is 1,
`[card]`/`[deck_card]` are the next deck position, and `[project_card]` is the next
project position. A legal `count: 0` consumes no deck or project position.

## Limits

A single Card block generates at most **2,000 physical cards**. A typo'd count of
`999999` triggers D007 and truncates that Card block with a note in the status bar
instead of freezing the editor.

Separately, each card instance has a shared budget of **500 `Repeat`/`ForEach`
iterations per card**. Every iteration of either node counts, including outer and
inner iterations of mixed nested loops. Crossing that budget is D004: the affected card becomes an error
placeholder rather than keeping a partially truncated face. Other cards continue to
generate normally.

## Several Card blocks

A project can have as many `Card:` blocks as you like, and they can share sheets and
templates. Each becomes its own group in the preview, and in
[PDF export](../export-and-project/01-pdf-export.md) each deck starts on its own page — decks never share a
sheet of paper.

`[card]` intentionally restarts for every Card block; `[deck_card]` is its more explicit
alias. Use `[project_card]` only when you want one running ordinal across every block,
and `[deck]` when the Card declaration name itself is meaningful.

```goblin
Card: Monster
  sheet: Monsters
  size: poker
  ...

Card: Token
  sheet: Tokens
  size: square
  ...
```13:T14bd,# Errors & diagnostics

CardGoblin's rule is: **one mistake never blanks your deck.**

Every error is reported in the panel where you can act on it, and the blast radius is
kept as small as the mistake.

| You see | It means |
|---|---|
| **Red squiggle in the code** | A code problem — typo, type mismatch, missing property. The preview and grid hold their last good state; the status bar shows "stale". |
| **Red cell in the grid** | That cell's value doesn't fit its column: not a number, not a valid enum option, an invalid Set/List member, or empty but needed. Only the cards built from that cell's row become placeholders — and if that row makes several copies (`count:`), the whole group goes together, since they're built from one evaluation. |
| **A grey placeholder card** | One card's data couldn't be evaluated — a bad cell, a divide by zero, a runaway repeat. The error messages are printed on the card. |
| **An amber dot on a card** | A [`TextBox`](04-text.md) on that card had its text clipped or shrunk to fit the box — not an error, just worth a look. |
| **A dimmed spreadsheet row** | A brand-new, never-edited empty row. It's excluded from the deck until you type into it. |
| **An icon showing raw text** like `HEARTZ` | An unknown [icon code](../reference/03-icons.md) — on an `Icon`, or an [inline marker](04-text.md#inline-icons) that rendered as its raw `{HEARTZ}` text. Fix the spelling. |
| **Raw text** like `{alias:damage_icon}` | D011: the [text alias](04-text.md#reusing-resolved-text-with-aliases) is unknown, statically non-Text, or could not be prepared as a valid target. The marker stays visible and the card still renders. |

## Two kinds of problem

**Code problems** are found before any data is touched — a syntax error, an unknown
reference, a type mismatch. They squiggle in the editor. While they're unresolved, the
preview keeps showing the last render that worked, and the grid keeps the last set of
columns that compiled, so nothing flickers while you're mid-edit.

**Data problems** are found while building actual cards — a cell that isn't a number,
an empty Number/single-Enum cell that a template needs, an invalid collection member,
a `count:` that isn't a whole number, a
computed value that breaks (division by zero, a runaway repeat). Most flag the
offending cell red where there is one and turn the affected cards into
placeholders — a row's `count:` copies always fail as ONE group, never
individually, even when only one of them actually triggered the problem (the
placeholder message says which one). Two are deliberately diagnostic-only:
unknown computed icon code D005 and an unavailable text-alias target D011 leave
their raw text visible on an otherwise rendered card. The rest of the deck renders
normally.

## Warnings

Some things are suspicious rather than wrong, and warn instead of erroring:

- a `Repeat` or `ForEach` variable shadowing a column name,
- a declaration nothing uses,
- an explicit `y_units` that makes units non-square,
- an icon code that isn't in the known list — on an `Icon` or in an inline
  `{marker}` in text — it may still be a real glyph, since the published list
  isn't exhaustive,
- an `asset:` reference to an upload that isn't in your library — in an `Image`
  `src:` or an inline `{asset:name}` marker — you might be about to add it.

A failed `{alias:name}` expansion is a non-fatal D011 data diagnostic rather than a
warning: the original marker stays visible and the rest of the card still renders.
This applies when the target is unknown, non-Text, or invalid during the compiler's
alias-preparation pass. A valid Text target that later hits bad row data keeps that
ordinary diagnostic and recovery posture — for example, D003 still produces a
placeholder instead of being converted to D011.

A top-level let that validly resolves to Text without Card data or for at least one
declared Card is the exception to "a declaration nothing uses": it can be named by
`{alias:name}` arriving only from spreadsheet data, so it and its global dependencies
are treated as externally addressable and do not get W002. Invalid or exclusively
non-Text lets are not alias exports and keep the ordinary unused-declaration behavior.

## Composition problems

Cyclic `let` references and recursive Template calls are E009 errors; the message
shows the dependency path. Template composition is also bounded per Card face: at
most **64 active Template calls** and **10,000 Template-node visits reached through
calls**. Crossing either limit is E010 while checking or D010 while building a card.
These limits charge composition only: a large call-free legacy Template cannot hit
them, and `Repeat`/`ForEach` share their separate 500-iteration limit.

## Recovering

- **Broken code?** Undo. The preview comes back live the moment the code parses again.
- **Placeholder cards?** Read the message printed on the card — it names the problem.
- **Errors after adding a column?** New `Number` and single-enum cells start empty; empty
  cells that a template references are an error by design, so that missing data is
  visible rather than silently defaulting to zero. Empty Set/List cells are valid.

For every code and its recovery posture, see the
[Diagnostics catalog](../reference/04-diagnostics.md).14:T97b,# Card sizes

`size:` on a [Card block](../goblin-script/08-cards-and-generation.md) picks the physical card. Sizes are
exact millimetres, which is what makes PDF export print true to size.

| `size:` | Physical | Inches | Good for |
|---|---|---|---|
| `poker` | 63.5 × 88.9 mm | 2.5 × 3.5 in | standard playing cards |
| `bridge` | 57.15 × 88.9 mm | 2.25 × 3.5 in | narrow hands, trick-takers |
| `american` | 56 × 87 mm | 2.2 × 3.43 in | board-game decks, the common sleeve size |
| `tarot` | 70 × 120 mm | 2.76 × 4.72 in | big art, oracle decks |
| `square` | 70 × 70 mm | 2.76 × 2.76 in | tiles, tokens |
| `mini` | 44 × 63.5 mm | 1.73 × 2.5 in | resource cards, dense layouts |
| `domino` | 44.45 × 88.9 mm | 1.75 × 3.5 in | tall narrow cards, tarot-style minis |

The millimetres are the real definition; the inches are those values rounded, so
they're what to compare against a sleeve pack, not what to print from.

## Units and size

The size preset and `x_units:` together fix the scale of everything you draw:

```goblin
size: poker
x_units: 20      # 1 unit = 63.5 ÷ 20 = 3.175 mm
y_units: auto    # 28 units tall — square units
```

With `y_units: auto` the units stay square and the vertical count follows from the
card's aspect ratio. It isn't always a whole number:

| Size | `x_units: 20` → height in units |
|---|---|
| `poker` | 28 exactly |
| `bridge` | 31.111… |
| `american` | 31.071… |
| `tarot` | 34.285… |
| `square` | 20 |
| `mini` | 28.863… |
| `domino` | 40 exactly |

`full` on the vertical axis means that value, whatever it is — so `height: full`
always spans the card.

## Custom sizes

When no preset fits, give the card's exact dimensions *instead of* `size:`:

```goblin
Card: Token
  sheet: Tokens
  width_mm: 40
  height_mm: 40
  x_units: 10      # 1 unit = 40 ÷ 10 = 4 mm
  y_units: auto
  Front: TokenFront
```

`width_mm:` and `height_mm:` are positive numbers in millimetres (decimals are
fine — `poker` itself is 63.5 wide), precise to two decimal places with a
0.01&nbsp;mm minimum, and they always travel as a pair: giving only one, or
combining either with `size:`, is an error.

Everything else works exactly as with a preset — `x_units:` divides the custom
width, `y_units: auto` keeps units square, and [PDF export](../export-and-project/01-pdf-export.md)
prints true to size. A card too large for the selected paper is reported when
you export.15:T8b6,# Colors

Any `color:` property accepts:

- **A standard CSS color name** — `white`, `black`, `red`, `gold`, `teal`, `grey`,
  `mediumpurple`, `hotpink`, `darkslateblue`, … all 148 of them.
- **Hex** — `#ff0000`, `#1a2b3c`. Six digits, always.

```goblin
Rectangle:
  x: 0
  y: 0
  width: full
  height: 3
  color: mediumpurple
```

## Colors from data

`color:` is an [expression](../goblin-script/07-expressions.md) like any other, so it can depend on the
card:

```goblin
color: if [cost] > 3 then gold else grey
```

```goblin
color: if [current_suit] == Suit.Rock then grey
       else if [current_suit] == Suit.Paper then gold
       else mediumpurple
```

## Images and part of a text

On an [`Image`](../goblin-script/05-images.md), `color:` is a multiply tint rather than a flat fill:
`white` (the default) leaves the art unchanged, white source pixels become the chosen
color, and darker source detail stays darker. Source transparency is preserved.

Inside `Text` or `TextBox`, nested `{color:red}…{/color}` tags can override the
element's whole-text `color:` for selected words and inline icons without affecting
wrapping. See [Scoped colors](../goblin-script/04-text.md#scoped-colors) for the syntax and its raw-text
failure behavior.

## Names only mean colors in color positions

A bare word is read against the type expected in that position. In a `color:` property
that's the CSS palette; elsewhere it isn't. So an enum case named `gold` and the color
`gold` can coexist without ambiguity:

```goblin
Enum: Metal
  case gold      # perfectly legal
  case silver

# ...compared as an enum case here:
color: if [metal] == Metal.gold then gold else silver
#                                    ^^^^ the color   ^^^^^^ the color
```

## Watch out for `#`

`#` starts a comment — *except* when it's followed by exactly six hex digits, where
it's a color literal. Don't open a comment with something like `#ff0000`.

## Printing

Colors are emitted to PDF as-is in RGB. There's no CMYK conversion, no color
management, and no bleed handling yet — for home printing and prototypes that's fine;
for a print shop, check with them first. Print specifics are on the
[roadmap](../export-and-project/06-roadmap.md).16:Td2f,# Icons

Icons come from **[Dicier](https://speakthesky.itch.io/typeface-dicier)** by Speak the
Sky — a game-icon typeface with 888 usable codes: dice, card suits, dominoes, coins,
tarot suits and more. Because it's a font, icons are vector, colorable, and embed
cleanly in PDFs.

```goblin
Icon:
  x: 1
  y: 1
  size: 2
  color: crimson
  code: "HEARTS"
```

Codes are **UPPERCASE quoted strings**. A misspelled code gets a warning squiggle and
renders as raw text on the card, so you can spot it immediately.

## Styles

Dicier draws every glyph in ten faces, and `style:` picks one per icon. It's
optional — leaving it off means `flat_dark`.

```goblin
Icon:
  x: 1
  y: 4
  size: 2
  code: "D20"
  style: round_heavy
```

| `style:` | Face |
|---|---|
| `flat_dark` | flat, filled shapes — **the default** |
| `flat_light` | flat, outlined |
| `flat_heavy` | flat, thick outlines |
| `block_dark` | blocky, filled |
| `block_light` | blocky, outlined |
| `block_heavy` | blocky, thick outlines |
| `round_dark` | rounded, filled |
| `round_light` | rounded, outlined |
| `round_heavy` | rounded, thick outlines |
| `pixel` | pixel art |

Unlike codes, the styles are a closed list — a misspelled style is an **error**,
not a warning, because there is no "maybe it exists" here.

## Codes can be computed

`code:` is an [expression](../goblin-script/07-expressions.md), so an icon can depend on the card's data:

```goblin
code: if [hp] > 5 then "CROWN" else "COIN"
```

## Repeating icons

The most common use is one icon per point of something —
see [`Repeat`](../goblin-script/03-templates-and-shapes.md):

```goblin
Repeat: [health] as i
  Icon:
    x: 1.5 + [i] * 2
    y: 25
    size: 1.8
    color: red
    code: "HEARTS"
```

## Categories

| Category | Sample codes |
|---|---|
| Card suits | `HEARTS` `DIAMONDS` `CLUBS` `SPADES` |
| Card values | `ACE` `TWO` … `TEN` `JACK` `QUEEN` `KING` |
| Value + suit | `ACE_HEARTS` `QUEEN_SPADES` … |
| Jokers | `JOKER` `RED_JOKER` `BLACK_JOKER` |
| Dice shapes | `D2` `D4` `D6` `D8` `D10` `D12` `D20` |
| Dice results | `3_ON_D6` `20_ON_D20` `ANY_ON_D8` … |
| Numbered dice | `0`–`9` |
| Fudge & special dice | fudge, yes/and/no/but, trigram, even/odd dice |
| Dominoes | generic, numbered, and wildcard dominoes |
| Coins | `COIN` `HEADS` `TAILS` `ANY_FLIP` `ON_EDGE` |
| Historic & tarot suits | season suits, minor arcana (`SWORDS` `CUPS` `COINS` `WANDS`), heckadeck |
| Misc | `CROWN` `ANCHOR`, zener cards (`Z_STAR` …), dreidel (`GIMEL` …) |

The complete list ships with the project at
[`docs/vendor/dicier-v1.5.4/Dicier codes v1_5_4.txt`](../../vendor/dicier-v1.5.4/Dicier%20codes%20v1_5_4.txt).
A browsable icon picker is on the [roadmap](../export-and-project/06-roadmap.md).

## Why unknown codes only warn

The published code list is known to be incomplete — several families end in "etc." —
so a code CardGoblin doesn't recognise may still be a real glyph. That's why it's a
warning, not an error, and why the icon still renders: if the glyph exists you'll see
it, and if it doesn't you'll see the raw text.

## Credit

Dicier v1.5.4 by Speak the Sky, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Commercial use is fine with
visible credit, and embedding in PDFs is explicitly allowed. If you publish a deck made
with CardGoblin, carry the credit forward.17:T13f6,# Diagnostics catalog

Every problem CardGoblin reports carries a code. The prefix tells you when it was
found and what happens next:

| Prefix | When it is raised | What you see |
|---|---|---|
| `E` | Compiling code, before row data is evaluated | Red squiggle; preview and grid keep their last good result |
| `W` | Compiling code; suspicious but not fatal | Warning squiggle; rendering continues |
| `D` | Generating actual cards from rows | Red cell, diagnostic, placeholder, or truncation as listed below |

Internal fallback codes `E000` and `D000` may appear if CardGoblin itself cannot
classify an unexpected compiler or generation failure. They are not mistakes users
are expected to target directly; preserve the project and report the message.

## Compile errors

| Code | Meaning | Usual fix |
|---|---|---|
| `E001` | Syntax error, including malformed interpolation | Fix the highlighted spelling, delimiter, indentation, or expression |
| `E002` | Unknown sheet, Template, enum, column, variable, or other reference | Correct the name or declare it in the reachable scope |
| `E003` | Type mismatch, including a value that cannot be interpolated | Supply the type required by that property or expression |
| `E004` | Bare enum case cannot be resolved from context | Qualify it, for example `Suit.Rock` |
| `E005` | Duplicate declaration, column, enum case, argument, or property | Keep one unique declaration/value |
| `E007` | Contextual keyword used where it is not legal | Use the keyword only in its supported property or axis |
| `E008` | Required property is missing or invalid, or a preset is unknown | Add/fix the named `Card` or shape property |
| `E009` | Cyclic `let` dependency or Template-call dependency | Break the dependency path printed in the message |
| `E010` | Template composition exceeds 64 active calls or 10,000 call-reached nodes per Card face | Remove recursion or flatten/reduce the composition graph |

`E006` is intentionally retired. Unknown literal icon codes were downgraded to
`W004` because Dicier's curated code list is not exhaustive.

## Compile warnings

| Code | Meaning | Usual fix |
|---|---|---|
| `W001` | A binding shadows another binding | Rename one when the overlap is accidental |
| `W002` | A declaration is unused | Remove it or reference it; top-level lets that validly resolve to Text as alias targets, and their global dependencies, are exempt |
| `W003` | Explicit `y_units` makes units non-square | Prefer `y_units: auto` unless stretching is deliberate |
| `W004` | Literal `Icon` code or inline Dicier marker is not in the known list | Check the spelling; it may still be a valid uncatalogued glyph |
| `W005` | Literal `asset:` image or inline asset marker is not in the current Assets library | Upload it or correct the asset name |

Warnings never replace a card with a placeholder.

## Data diagnostics

`D001`–`D003` identify a source cell, flag it red, and replace every affected card
with a labelled placeholder. The other codes have no single source cell and use the
posture stated in the table.

| Code | Meaning | Result |
|---|---|---|
| `D001` | Cell value is not valid for its enum type: an unknown case, or a Set/List with an unknown or empty item or duplicate Set member | Affected cards become placeholders |
| `D002` | Cell is not numeric in a Number column | Affected cards become placeholders |
| `D003` | An edited row has an empty Number or single-enum cell that generated content needs; empty Sets/Lists are valid | Affected cards become placeholders |
| `D004` | `Repeat` count is negative/non-integer, or the shared `Repeat`/`ForEach` budget exceeds 500 iterations | Affected card becomes a placeholder; no partial face is kept |
| `D005` | A computed `Icon` code or inline marker is unknown | Diagnostic only; the failed ligature/raw marker remains visible |
| `D006` | `count:` is negative, non-integer, or cannot be evaluated | One placeholder for that row × loop-case combination |
| `D007` | One `Card:` block exceeds 2,000 physical instances | That block is truncated and generation continues |
| `D008` | Numeric evaluation is non-finite, such as division by zero | Affected card becomes a placeholder |
| `D009` | QR data exceeds the selected error-correction level's maximum capacity | Affected card becomes a placeholder |
| `D010` | Runtime Template composition exceeds 64 active calls or 10,000 call-reached nodes for one face/copy | Affected card becomes a placeholder |
| `D011` | A [resolved-text alias](../goblin-script/04-text.md#reusing-resolved-text-with-aliases) has no top-level target, has a statically non-Text target, or could not be prepared as a valid target | Diagnostic only; the raw `{alias:name}` marker stays visible and the card renders |

See [Errors & diagnostics](../goblin-script/09-errors.md) for how these states look
in the editor and how last-good preview behavior protects the rest of the deck. Data
errors raised while evaluating an otherwise valid Text alias keep their own code and
result (for example, D003 still makes a placeholder); they are not remapped to D011.18:T1a2d,# PDF export

**Export PDF** sits in the preview toolbar. It prints what the preview shows, so if
your code is mid-break the export uses the same last-good render you're looking at.

The button is disabled until there's at least one card to print.

## Choosing which cards to print

Every time you open **Export PDF**, **Cards to print** starts on **All**. Switch to
**Custom** or choose **Choose cards…** when you only need part of a large project.
This is a print-run choice only: it does not change your Goblin code, spreadsheet
rows, `count:`, saved project, or cloud copy.

The chooser shows card thumbnails grouped by `Card:` block. Use the Front/Back
toggle to identify either face, click individual checkboxes, or use **Select all**
and **Clear**. Cards with data errors stay visible at their original number but are
unavailable because they have no printable face.

For a quick known selection, type project-wide card numbers such as
`1-6, 16, 18`. Commas and ascending inclusive ranges are accepted; spaces and
duplicate numbers are harmless. **Select only** replaces the current selection and
**Deselect** removes those numbers. A malformed, backwards, or out-of-range entry
shows an error and changes nothing.

These are generated-card numbers, not spreadsheet row numbers. Loops and `count:`
can turn one row into several independently selectable cards. The numbers match the
editor's project-wide card order and the `@project_card` column in
[Export Data](08-data-export.md). They never change when earlier cards are omitted.

Selected cards keep their original order and pack together normally within their
own deck; they do not leave blank holes. Decks still never share a page. The live
page preview, matching backs, image checks, and export progress all update to the
selected print run. Closing and reopening the export modal resets the choice to All.

## The preview

Next to the options is a picture of the actual page. It redraws as you change
anything, so margins, spacing, cut lines and the mirrored back pages are all
visible **before** you spend a render on a PDF. The arrows above it step through
every page the export will contain — with duplex backs, page 2 is page 1's mirrored
back.

It's drawn from the same layout the exporter uses, with the same card artwork, so it
can't drift from the file you get. The one thing it can't show you is the 300 DPI
rasterization: on paper the cards are images, here they're live vector art.

## The options

| Option | Default | What it does |
|---|---|---|
| **Page size** | Letter (215.9 × 279.4 mm) | Or A4 (210 × 297 mm). |
| **Backs** | Duplex | How back faces are laid out — see below. |
| **Outer margin (mm)** | 10 | Blank border on every page. Most home printers can't print to the edge. It's a minimum: the card grid is centred left-to-right (that centring is what keeps duplex backs aligned) and starts at the top margin, so the side margins are often a little wider than you asked for. |
| **Card spacing (mm)** | 0 | Gap between cards. `0` means neighbours share a cut line — less cutting, no margin for error. |
| **Cut lines** | Dotted | Lines running edge to edge across the page at every card boundary. Also: off, red, bold. |
| **Cross marks** | Off | Small crop crosses at card corners only. Also: dotted, red, bold. |
| **Print page numbers** | Off | Adds plain text such as `1/10 front` or `1/10 back` immediately below the lowest card row. It never covers a card. A matching front/back pair shares its number, even in Separate mode. |

Guide styles are: **dotted** (0.2 mm dotted black), **red** (0.2 mm solid, easy to see
against dark art), **bold** (0.5 mm solid black).

## Backs

- **Duplex** — after each page of fronts comes the matching page of backs, with columns
  mirrored. That's what makes a double-sided print line up when your printer flips on
  the long edge.
- **Separate** — all front pages first, then all back pages. For manual re-feeding.
- **None** — fronts only.

Cut guides are drawn on back pages too, aligned to the mirrored grid.

When **Print page numbers** is on, numbering counts physical card sheets rather than
PDF pages. That is why matching sides say `1/10 front` and `1/10 back`: the label is
meant to keep those two pages paired after printing. The live page preview shows the
same label before export. The label is placed below the final occupied card row and
is never pulled back over artwork. If the card grid reaches the bottom of the page,
the label can fall outside your printer's printable area or be clipped by the PDF
page; increase the outer margin if you need the label to print.

## How it lays out

Decks never share a page: each `Card:` block starts fresh. Within a deck, as many cards
as fit inside the margins are placed row by row.

If a deck's cards can't fit even once inside the margins, the modal says so and blocks
the export — reduce the margin or spacing, or choose a larger page.

## Quality and errors

- Each **distinct** card face is rendered once at **300 DPI** through the browser's own
  renderer, so fonts and icon ligatures come out exactly as they look in the preview,
  then reused everywhere it appears. A `count: 10` card doesn't cost ten renders.
- While exporting, a progress bar advances through card-face rendering, image
  embedding, page construction, and final PDF saving. Large decks can still take a
  while, but the current stage and percentage remain visible.
- **Error placeholder cards are skipped.** If any exist, the modal warns you how many
  before you export. They appear disabled in the card chooser. If *every* card is a
  placeholder—or a Custom selection contains no printable cards—there's nothing to
  print and export is blocked.
- **Images are checked before you export.** When the deck uses
  [`Image`](../goblin-script/05-images.md) shapes, the modal probes their URLs as it opens.
  Embedding an image into the PDF needs the host's permission (the file is fetched
  with `crossorigin=anonymous`, so the server must allow cross-origin use — CORS). Any
  image that can't be embedded is warned about in the modal — "N images could not be
  embedded" — and prints as an amber crossed-out placeholder box. The export itself
  is never blocked by a broken image.
- Copy counts are honoured — a `count: 2` card prints twice.
- The file downloads as `<deckname>.pdf` for a single-deck project, `cardgoblin.pdf`
  otherwise.

Your option choices are remembered until you reload the page.

## Not yet

Bleed, safe zones, CMYK, and per-deck page settings aren't there yet — see the
[roadmap](06-roadmap.md). For a professional print run, check the printer's requirements
before committing.19:Tae8,# Autosave

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
  nothing survives a reload.1a:Te48,# Project files

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
another device.1b:Te21,# Uploaded assets

`src:` on an [`Image`](../goblin-script/05-images.md) doesn't have to be a URL. The
**Assets** drawer holds pictures uploaded straight from your machine, so your own
art can go on a card with nothing to host and no link to keep alive.

## The drawer

The **Assets** button in the status bar (with a count badge once you've uploaded
something) opens a drawer where you upload images — drag and drop, or the file
picker. Each upload gets a name, derived from the filename and renameable anytime,
plus a thumbnail and a **Copy ref** button that copies `asset:<name>`, ready to
paste into a `src:` line.

## Referencing an upload

Reference an upload with the `asset:` scheme instead of a URL:

```goblin
Image: "Portrait"
  x: 2
  y: 4
  width: 16
  height: 12
  src: "asset:dragon_art"
```

Everything about `src:` being a Text expression still applies — an asset reference
works from a sheet column (`src: [art]`) or built with interpolation
(`src: "asset:[art]"`), so different rows can point at different uploads exactly
like different URLs.

Uploads also work *inside text*: `{asset:dragon_art}` in any `Text` or `TextBox`
`text:` draws the upload as an inline icon in a one-em slot — see
[Inline icons](../goblin-script/04-text.md#inline-icons).

If the same colored asset fragment belongs at different positions inside many
spreadsheet descriptions, wrap it in a top-level Text let and place it with
`{alias:name}`. The [resolved-text alias example](../goblin-script/04-text.md#reusing-resolved-text-with-aliases)
uses `{color:#cc2222}{asset:swords}{/color}` so each cell can say, for example,
`Deal 2 {alias:damage_icon}.` without duplicating the asset/color markup.

## The 2 MB cap

**2 MB** per image — enough for card-sized art at print resolution, not a place
for full-resolution photography. The drawer says so if a file is over the limit.

## Renaming only updates the library

Renaming doesn't rewrite `src:` lines for you — rename `dragon_art` to `dragon`
and every `src: "asset:dragon_art"` still says the old name, now pointing at
nothing. Update those references yourself; the compiler's unknown-asset warning
squiggles exactly the `src:` lines that need it, so you won't miss one.
Referencing a name that doesn't exist yet (or anymore) isn't an error, just that
warning — you might be about to upload it.

## Where uploads are stored

Uploads live in this browser's IndexedDB, separately from the code-and-rows
[autosave](02-autosave.md): they save **the moment you upload them**, not on
autosave's one-second debounce, and they survive a reload the same way the rest of
your project does. Opening or importing another project switches its uploads
together with its code and rows — separate stores under the hood, activated as one
project.

Uploaded assets always embed in an [exported PDF](01-pdf-export.md) — unlike URL art,
they never depend on a host allowing cross-origin use, since the file never leaves
your browser.

[Exporting a project file](03-project-files.md) bundles your uploads into the file
itself — the art, not just a reference to it — so handing someone a
`.cardgoblin.json` hands them the art too. A file exported before uploaded assets
existed has no art in it, so the newly imported project starts with no uploads.

Each immutable project ID has its own browser library. Anonymous projects stay
on this device; an exported [project file](03-project-files.md) is the supported
way to move one. Signed-in administrator cloud projects upload reviewed formats
under content-addressed keys and restore them with the project on another device.1c:Ta39,# Current limits

CardGoblin is young and moving. These are the walls you're most likely to hit — better
to read them now than to discover them three hours into a deck.

## Text

- **`Text` is one line by design** — long text runs off the card rather than
  flowing. Wrapped, multi-line text is what
  [`TextBox`](../goblin-script/04-text.md) is for.
- **No bold/italic spans yet.** A `TextBox` can mix scoped colors and inline
  Dicier/uploaded-asset icons, but font face and size still apply to the whole
  element.
- **Bundled fonts only.** `Text` and `TextBox` offer nine bundled faces through
  `font:`. Uploading an arbitrary font file is not supported yet.

## Images

- **2 MB** per uploaded asset. The [Assets drawer](04-assets.md) caps
  each upload — plenty for print-resolution card art, not a place for
  full-resolution photography.
- **PDF embedding needs CORS for URL art.** An image displays in the preview from
  any URL, but embedding a URL image into an exported PDF requires the host to
  allow cross-origin use — see [PDF export](01-pdf-export.md). Hosts that don't
  cooperate print as placeholder boxes. Uploaded assets don't have this
  limitation — they always embed, since the art never leaves your browser.

## Persistence

- **One save slot per browser.** Your project [autosaves](02-autosave.md) and survives
  reloads, and [project files](03-project-files.md) cover backup and moving between
  browsers — but the autosave slot is singular, so two open editor tabs overwrite
  each other (the last one to change wins).

## Size caps

- **500 structural iterations per card.** Every iteration of every `Repeat` and
  `ForEach` counts, including nested outer and inner iterations.
- **2,000 physical cards per `Card:` block.**

Both exist so a typo in a data cell can't hang the editor, but their failure posture
differs. Crossing the shared iteration budget is D004 and makes the affected card an error
placeholder — no partially truncated face is kept. Crossing the physical-card cap is
D007 and truncates that Card block with a note.

## Printing

- Colors are RGB; no CMYK conversion or color management.
- No bleed or safe-zone guides — cut lines and crop marks only.
- A card bigger than the page can't be split across sheets — [export](01-pdf-export.md)
  reports it instead of tiling it.

## Editing

- **No shared undo.** The code editor and the spreadsheet keep separate undo
  histories — Ctrl+Z in one never rewinds the other.

Most of these are on the [roadmap](06-roadmap.md) in some form. If one of these is
blocking you, that's useful signal — say so.1d:T15d9,# Roadmap

CardGoblin is a living project. This page says where it actually is — expect it to
change.

## Shipped

**The editor and the language.** Code, live SVG preview, and a schema-driven
spreadsheet, wired together with a ~300 ms live compile. Enums, sheets, templates,
shapes, `Repeat`, `Set<Enum>`/`List<Enum>` data with `contains` and `ForEach`, the full
expression engine, and per-card error isolation — the whole
pipeline from script to rendered deck.

**PDF export.** Page size, margins, spacing, cut lines, crop marks, and
duplex-mirrored backs, rendered at 300 DPI. See [PDF export](01-pdf-export.md).

**Autosave.** Your project — code and rows — survives a reload in your browser;
**New / Open Project** returns to the project chooser. See [Autosave](02-autosave.md).

**Autocomplete.** The code editor suggests what fits where your cursor is — column
names, property names, enum cases, color names, icon codes. See
[The editor](../getting-started/03-the-editor.md).

**Custom card sizes.** `width_mm:` + `height_mm:` on a Card, beyond the
[built-in presets](../reference/01-card-sizes.md).

**Icon styles.** All ten Dicier faces (flat/block/round × dark/light/heavy,
plus pixel) via `style:` — see [Icons](../reference/03-icons.md).

**The `Image` element.** Your own artwork on a card, from a URL — with `fit:`
control and PDF embedding. See [Images](../goblin-script/05-images.md).

**Uploaded assets.** An Assets drawer for images local to your machine — upload,
rename, delete, and reference them with `asset:<name>` in any `src:`, no hosting
required. Bundled into [project files](03-project-files.md) so art travels with the
project. See [Uploaded assets](04-assets.md).

**Project files.** Export the project as a file and import it back — backup,
moving between browsers, and keeping more than one project. See
[Project files](03-project-files.md).

**Template composition and parameters.** Templates can declare typed `param`
inputs and call other Templates in source order, including inside `If`, `Else`,
`Repeat`, and `ForEach`. Arguments are explicit, so nested layouts stay reusable without hidden
caller state. See [Templates & shapes](../goblin-script/03-templates-and-shapes.md).

**Text wrapping.** The `TextBox` element: multi-line text that wraps in the
compiler itself, so the preview and the PDF always agree — with hard breaks
(`\n` and newlines in cells), alignment, and clip/shrink overflow control. See
[Text & TextBox](../goblin-script/04-text.md).

**Fonts.** Nine bundled faces on `Text` and `TextBox` — Geist (the default)
plus eight more from Cormorant Garamond and Courier Prime — via `font:`, with
wrapping measured against each font's own letterforms. See
[Text & TextBox](../goblin-script/04-text.md).

**QR codes.** The `Qr` element: scannable codes generated straight from sheet
data, with error-correction levels and a scan-safe quiet zone — the idiom for
giving every card in a deck its own code on the back. See
[QR codes](../goblin-script/06-qr-codes.md).

**Inline icons.** `{HEARTS}` and `{asset:skull}` markers draw Dicier glyphs and
uploaded art right inside `Text` and `TextBox` text — including markers that
arrive from cell data — each in a one-em slot that wraps like a word. See
[Inline icons](../goblin-script/04-text.md#inline-icons).

**Reusable resolved text.** `{alias:name}` expands a top-level Text-valued
`let name:` once before inline icon, asset, and color markers are parsed — also
when the alias marker comes from cell data. A cell such as
`Deal 2 {alias:damage_icon}.` can insert one shared, tinted swords asset. See
[Text aliases](../goblin-script/04-text.md#reusing-resolved-text-with-aliases).

**Additive color styling.** Image `color:` multiply-tints artwork (white is the
unchanged default), while nested `{color:red}…{/color}` scopes recolor words,
Dicier glyphs, and inline asset art without changing TextBox wrapping. See
[Images](../goblin-script/05-images.md#recolor-white-artwork) and
[Scoped colors](../goblin-script/04-text.md#scoped-colors).

## Further out

- **Sharing by link** — a read-only view of a deck anyone can open. The security,
  hosting cost, expiry, and deletion model still need design before this is a
  promise.
- **Uploaded fonts** — `font:` currently picks from a small bundled set (see
  [Text & TextBox](../goblin-script/04-text.md)); bringing your OWN font file, the way uploaded
  assets already work for images, is a separate, later piece.
- **Rich text in boxes** — inline icons and scoped colors shipped (see
  [Text & TextBox](../goblin-script/04-text.md)); **bold and italic runs** are
  the remaining piece, still a later design round.
- **A browsable icon picker** — search and preview the [888 Dicier
  codes](../reference/03-icons.md) visually instead of typing them from memory.

## Open questions

Things that are genuinely undecided, not just unbuilt:

- **Auto-layout containers** (`Row`, `Stack`) as sugar over `Repeat` — worth the
  language surface, or is index math enough?
- **Inline face templates** — anonymous Template bodies directly beneath `Front:`
  or `Back:`; named Template composition is already shipped.
- **Print fidelity** — bleed, safe zones, and what "print-ready" should mean for a
  professional run rather than a home printer.

## Following along

The design document — including every decision made so far and why — lives in the
repository at [`docs/DESIGN.md`](../../DESIGN.md). If you want to build on
CardGoblin, [`docs/development.md`](../../development.md) is the developer guide.1e:Tb30,# Data export

**Export Data** in the status bar downloads a CSV print manifest. It contains one row
for every generated card instance—not merely one row for every spreadsheet row—so
`loop:` combinations and `count:` copies appear separately and in the same order as
the preview and PDF.

The first columns identify each instance:

| CSV column | Meaning |
|---|---|
| `@card` | `Card:` declaration name |
| `@sheet` | Bound `Sheet:` name |
| `@row` | 1-based source row number |
| `@card_number` | 1-based position inside that generated deck; the same value as `[card]` / `[deck_card]` |
| `@project_card` | 1-based physical position across every generated deck; the same value as `[project_card]` |
| `@copy` | 1-based position among the current `count:` copies |
| `@loop.<name>` | Selected enum case for each Card loop variable |

Those `@` names cannot collide with Goblin identifiers. The remaining columns are
the physical sheet cells followed by any virtual columns. Projects with several Card
blocks or sheets use the union of their columns; cells that do not apply to an
instance are empty. CSV quoting follows the standard comma/newline/double-quote
rules, and the file is UTF-8.

## Virtual columns

A virtual column is a formula declared inside a Sheet:

```goblin
Sheet: Monsters
  column name: Text
  column code: Text
  column count: Number
  virtual column card_code: Text = "[card]|[code]"
```

It is type-checked like other Goblin expressions and evaluates once for the exact
generated card instance, so `[card]` can produce a different value for each copy.
Columns, Card loop variables, all generation built-ins, and program `let` bindings are
all available. For example, the formula can be shared through a global:

```goblin
let card_code: "[card]|[code]"

Sheet: Monsters
  column code: Text
  virtual column card_code: Text = [card_code]
```

Virtual columns never appear in the spreadsheet, are never stored in row data, and
cannot be edited. Change their expressions in the code editor. Their names must not
duplicate a physical or another virtual column in the same Sheet.

For a single Card block the download is named after that Card, such as
`Monster.csv`; projects with several Card blocks download `cardgoblin-data.csv`.

## Errors and the current preview

CSV follows the current generated RenderModel. A row whose data fails produces the
same labelled error-placeholder instance in the model, so that instance still gets
a CSV row and its available identity/source values. PDF export deliberately skips
error-placeholder cards because there is no printable face to lay out.

While the code editor is broken, the preview holds the last good RenderModel. Export
Data uses that same last good result; it does not combine stale cards with the
currently invalid source. If no Card block generates any instances, export is
disabled.0:{"P":null,"b":"ienubagD7JsO89JDZefAn","p":"","c":["","docs","qr-codes"],"i":false,"f":[[["",{"children":["docs",{"children":[["slug","qr-codes","d"],{"children":["__PAGE__",{}]}]}]},"$undefined","$undefined",true],["",["$","$1","c",{"children":[[["$","link","0",{"rel":"stylesheet","href":"/_next/static/css/a85a0228f50c72e6.css","precedence":"next","crossOrigin":"$undefined","nonce":"$undefined"}]],["$","html",null,{"lang":"en","children":["$","body",null,{"className":"__variable_1e4310 __variable_c3aa02 antialiased","children":[["$","$L2",null,{"parallelRouterKey":"children","error":"$undefined","errorStyles":"$undefined","errorScripts":"$undefined","template":["$","$L3",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":[[["$","title",null,{"children":"404: This page could not be found."}],["$","div",null,{"style":{"fontFamily":"system-ui,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\"","height":"100vh","textAlign":"center","display":"flex","flexDirection":"column","alignItems":"center","justifyContent":"center"},"children":["$","div",null,{"children":[["$","style",null,{"dangerouslySetInnerHTML":{"__html":"body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}"}}],["$","h1",null,{"className":"next-error-h1","style":{"display":"inline-block","margin":"0 20px 0 0","padding":"0 23px 0 0","fontSize":24,"fontWeight":500,"verticalAlign":"top","lineHeight":"49px"},"children":404}],["$","div",null,{"style":{"display":"inline-block"},"children":["$","h2",null,{"style":{"fontSize":14,"fontWeight":400,"lineHeight":"49px","margin":0},"children":"This page could not be found."}]}]]}]}]],[]],"forbidden":"$undefined","unauthorized":"$undefined"}],["$","$L4",null,{}]]}]}]]}],{"children":["docs",["$","$1","c",{"children":[null,["$","div",null,{"className":"min-h-screen bg-gray-900 text-gray-300","children":[["$","header",null,{"className":"sticky top-0 z-40 border-b border-gray-800 bg-gray-900/90 backdrop-blur","children":["$","div",null,{"className":"mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6","children":[["$","$L5",null,{"href":"/","className":"flex items-center gap-3","children":[["$","$L6",null,{"src":"/card_goblin_logo_simple_2.svg","alt":"","width":36,"height":36,"aria-hidden":true}],["$","span",null,{"className":"font-extrabold tracking-tight text-white","children":"Card Goblin"}],["$","span",null,{"className":"hidden text-sm text-gray-500 sm:inline","children":"Docs"}]]}],["$","div",null,{"className":"flex items-center gap-5 text-sm","children":[["$","$L5",null,{"href":"/","className":"text-gray-400 hover:text-white","children":"Home"}],["$","$L5",null,{"href":"/editor","className":"rounded-lg bg-teal-500 px-3 py-1.5 font-semibold text-gray-900 hover:bg-teal-400","children":"Open Editor"}]]}]]}]}],["$","div",null,{"className":"mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:flex-row lg:gap-12","children":[["$","$L7",null,{"nav":[{"id":"getting-started","title":"Getting started","blurb":"What CardGoblin is, and a first deck in five minutes.","pages":[{"slug":"what-is-cardgoblin","section":"getting-started","order":1,"title":"What is CardGoblin","status":"stable","summary":"A script plus a spreadsheet becomes a print-at-home deck, live as you type.","body":"$8"},{"slug":"quickstart","section":"getting-started","order":2,"title":"Quickstart","status":"stable","summary":"The five-minute tour — a sample project, block by block.","body":"$9"},{"slug":"the-editor","section":"getting-started","order":3,"title":"The editor","status":"stable","summary":"The three panels, the status bar, and how live compiling behaves.","body":"$a"}]},{"id":"goblin-script","title":"Goblin script","blurb":"The language: sheets, templates, shapes, expressions, generation.","pages":[{"slug":"basics","section":"goblin-script","order":1,"title":"Basics & syntax","status":"stable","summary":"Indentation, comments, names, labels — the shape of every Goblin file.","body":"$b"},{"slug":"sheets-and-data","section":"goblin-script","order":2,"title":"Sheets & data","status":"stable","summary":"Declaring columns and enums, and how [references] resolve.","body":"$c"},{"slug":"templates-and-shapes","section":"goblin-script","order":3,"title":"Templates & shapes","status":"stable","summary":"Templates, the grid, the shape index, pivots, rotation, and Repeat — the drawing model shapes share.","body":"$d"},{"slug":"text","section":"goblin-script","order":4,"title":"Text & TextBox","status":"stable","summary":"Single-line and wrapped text, reusable aliases, inline icons, colors, and fonts.","body":"$e"},{"slug":"images","section":"goblin-script","order":5,"title":"Images","status":"stable","summary":"The Image element — your own artwork from a URL or an uploaded asset, fit modes, and auto sizing.","body":"$f"},{"slug":"qr-codes","section":"goblin-script","order":6,"title":"QR codes","status":"stable","summary":"The Qr element — scannable codes generated straight from sheet data.","body":"$10"},{"slug":"expressions","section":"goblin-script","order":7,"title":"Expressions","status":"stable","summary":"Arithmetic, comparisons, logic, and if/then/else — anywhere a value goes.","body":"$11"},{"slug":"cards-and-generation","section":"goblin-script","order":8,"title":"Cards & generation","status":"stable","summary":"The Card block, and the rows × loops × count math that builds a deck.","body":"$12"},{"slug":"errors","section":"goblin-script","order":9,"title":"Errors & diagnostics","status":"stable","summary":"What each kind of error looks like, and why one mistake never blanks a deck.","body":"$13"}]},{"id":"reference","title":"Reference","blurb":"Lookup tables — card sizes, colors, icon codes, error codes.","pages":[{"slug":"card-sizes","section":"reference","order":1,"title":"Card sizes","status":"stable","summary":"The built-in physical card presets — and custom millimetre sizes — in exact millimetres.","body":"$14"},{"slug":"colors","section":"reference","order":2,"title":"Colors","status":"stable","summary":"CSS color names and hex, and why a case named \"gold\" never collides.","body":"$15"},{"slug":"icons","section":"reference","order":3,"title":"Icons","status":"stable","summary":"The 888 Dicier game glyphs — how to use them, the ten styles, and the categories.","body":"$16"},{"slug":"diagnostics","section":"reference","order":4,"title":"Diagnostics catalog","status":"stable","summary":"Every E, W, and D code, what it means, and whether the affected card still renders.","body":"$17"}]},{"id":"export-and-project","title":"Export & project","blurb":"Printing your deck, saving and moving your project, current limits, and the roadmap.","pages":[{"slug":"pdf-export","section":"export-and-project","order":1,"title":"PDF export","status":"evolving","summary":"Print options — page size, margins, cut lines, and duplex-mirrored backs.","body":"$18"},{"slug":"autosave","section":"export-and-project","order":2,"title":"Autosave","status":"evolving","summary":"Your project saves itself in this browser — what persists, when, and the limits.","body":"$19"},{"slug":"project-files","section":"export-and-project","order":3,"title":"Project files","status":"stable","summary":"Export your project as a file and import it back — backup, moving machines, and more than one project.","body":"$1a"},{"slug":"assets","section":"export-and-project","order":4,"title":"Uploaded assets","status":"stable","summary":"Bring your own art with no hosting — the Assets drawer, the 2 MB cap, and how uploads are stored.","body":"$1b"},{"slug":"limits","section":"export-and-project","order":5,"title":"Current limits","status":"evolving","summary":"What CardGoblin can't do yet, so you find out here and not mid-project.","body":"$1c"},{"slug":"roadmap","section":"export-and-project","order":6,"title":"Roadmap","status":"evolving","summary":"What's shipped, what's being built, and what's still an open question.","body":"$1d"},{"slug":"data-export","section":"export-and-project","order":8,"title":"Data export","status":"stable","summary":"Export one CSV row for every generated card, including computed virtual columns.","body":"$1e"}]}]}],"$L1f"]}]]}]]}],{"children":[["slug","qr-codes","d"],"$L20",{"children":["__PAGE__","$L21",{},null,false]},null,false]},null,false]},null,false],"$L22",false]],"m":"$undefined","G":["$23",[]],"s":false,"S":true}
25:I[4431,[],"OutletBoundary"]
27:I[5278,[],"AsyncMetadataOutlet"]
29:I[4431,[],"ViewportBoundary"]
2b:I[4431,[],"MetadataBoundary"]
2c:"$Sreact.suspense"
1f:["$","main",null,{"className":"min-w-0 max-w-3xl flex-1 pb-16","children":["$","$L2",null,{"parallelRouterKey":"children","error":"$undefined","errorStyles":"$undefined","errorScripts":"$undefined","template":["$","$L3",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":"$undefined","forbidden":"$undefined","unauthorized":"$undefined"}]}]
20:["$","$1","c",{"children":[null,["$","$L2",null,{"parallelRouterKey":"children","error":"$undefined","errorStyles":"$undefined","errorScripts":"$undefined","template":["$","$L3",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":"$undefined","forbidden":"$undefined","unauthorized":"$undefined"}]]}]
21:["$","$1","c",{"children":["$L24",null,["$","$L25",null,{"children":["$L26",["$","$L27",null,{"promise":"$@28"}]]}]]}]
22:["$","$1","h",{"children":[null,[["$","$L29",null,{"children":"$L2a"}],["$","meta",null,{"name":"next-size-adjust","content":""}]],["$","$L2b",null,{"children":["$","div",null,{"hidden":true,"children":["$","$2c",null,{"fallback":null,"children":"$L2d"}]}]}]]}]
24:["$","article",null,{"children":[["$","header",null,{"className":"mb-8 border-b border-gray-800 pb-6","children":[["$","div",null,{"className":"mb-3 flex flex-wrap items-center gap-3","children":[["$","h1",null,{"className":"text-3xl font-extrabold tracking-tight text-white","children":"QR codes"}],["$","span",null,{"title":"This part of CardGoblin is settled — expect it to keep working.","className":"inline-block rounded-full border px-2 py-0.5 text-xs font-medium border-teal-700 bg-teal-950 text-teal-300 ","children":"Stable"}]]}],["$","p",null,{"className":"text-gray-400","children":"The Qr element — scannable codes generated straight from sheet data."}]]}],["$","div",null,{"className":"text-[15px] leading-7 text-gray-300","children":[["$","pre","pre-0",{"className":"my-5 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-[13px] leading-6 text-gray-300","children":["$","code","code-0",{"className":"font-mono","children":"Qr:\n  x: 2\n  y: 2\n  size: 6\n  data: [code]\n"}]}],"\n",["$","p","p-0",{"className":"my-4","children":[["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data:"}]," is a text ",["$","$L5","a-0",{"href":"/docs/expressions","className":"text-teal-400 underline decoration-teal-800 underline-offset-2 hover:text-teal-300","children":"expression"}],", so the code can come straight from a\nsheet column (",["$","code","code-1",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data: [code]"}],"), be interpolated (",["$","code","code-2",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data: \"https://example.com/[code]\""}],"),\nor be computed with a conditional — the usual coercions apply."]}],"\n",["$","h2","h2-0",{"id":"the-idiom-one-qr-per-card-on-the-back","aria-label":"The idiom: one QR per card, on the back","className":"group scroll-mt-24 mb-3 mt-10 border-b border-gray-800 pb-2 text-2xl font-bold text-white","children":["The idiom: one QR per card, on the back",["$","a",null,{"href":"#the-idiom-one-qr-per-card-on-the-back","aria-label":"Link to this section","className":"ml-2 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100","children":"#"}]]}],"\n",["$","p","p-1",{"className":"my-4","children":["The point of a card's QR is usually to let a companion app scan it and act — a\ncross-media game where the app is out of scope for CardGoblin, but the code on the\ncard is exactly what it needs. Because ",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"Back:"}]," templates evaluate per card just like\n",["$","code","code-1",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"Front:"}]," templates (every card sees its own row's data), a ",["$","code","code-2",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"Back:"}]," template needs\nnothing extra to give every card in the deck a different code:"]}],"\n",["$","pre","pre-1",{"className":"my-5 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-[13px] leading-6 text-gray-300","children":["$","code","code-0",{"className":"font-mono","children":"Qr:\n  x: 2\n  y: 2\n  size: 16\n  data: [code]\n"}]}],"\n",["$","p","p-2",{"className":"my-4","children":["Those four lines — ",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"x y size data"}]," — are the whole idiom: a Text column of codes in\nyour sheet, one ",["$","code","code-1",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"Qr:"}]," block in a ","$L2e"," template, and every card's back carries its\nown scannable code."]}],"\n","$L2f","\n","$L30","\n","$L31","\n","$L32","\n","$L33","\n","$L34","\n","$L35","\n","$L36"]}],"$L37"]}]
2e:["$","code","code-2",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"Back:"}]
2f:["$","h2","h2-1",{"id":"level-error-correction","aria-label":"level: — error correction","className":"group scroll-mt-24 mb-3 mt-10 border-b border-gray-800 pb-2 text-2xl font-bold text-white","children":[[["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"level:"}]," — error correction"],["$","a",null,{"href":"#level-error-correction","aria-label":"Link to this section","className":"ml-2 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100","children":"#"}]]}]
30:["$","p","p-3",{"className":"my-4","children":["QR codes carry redundant data on purpose, so a code still scans even partly\nobscured, scratched, or printed small. ",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"level:"}]," picks how much:"]}]
31:["$","div","table-0",{"className":"my-5 overflow-x-auto rounded-lg border border-gray-800","children":["$","table",null,{"className":"w-full border-collapse text-sm","children":[["$","thead","thead-0",{"className":"bg-gray-800/60","children":["$","tr","tr-0",{"children":[["$","th","th-0",{"className":"border-b border-gray-800 px-3 py-2 text-left font-semibold text-gray-200","children":["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"level:"}]}],["$","th","th-1",{"className":"border-b border-gray-800 px-3 py-2 text-left font-semibold text-gray-200","children":"What it does"}]]}]}],["$","tbody","tbody-0",{"children":[["$","tr","tr-0",{"children":[["$","td","td-0",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"l"}]}],["$","td","td-1",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":"roughly 7% of the code can be damaged and it still scans"}]]}],["$","tr","tr-1",{"children":[["$","td","td-0",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"m"}]}],["$","td","td-1",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":["roughly 15% — ",["$","strong","strong-0",{"className":"font-semibold text-gray-100","children":"the default"}]]}]]}],["$","tr","tr-2",{"children":[["$","td","td-0",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"q"}]}],["$","td","td-1",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":"roughly 25%"}]]}],["$","tr","tr-3",{"children":[["$","td","td-0",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"h"}]}],["$","td","td-1",{"className":"border-b border-gray-800/60 px-3 py-2 align-top","children":"roughly 30% — the most damage-tolerant, at the densest code for the same data"}]]}]]}]]}]}]
32:["$","p","p-4",{"className":"my-4","children":["A higher level may need a bigger code for larger payloads (more of the code's\ncapacity goes to redundancy instead of your content, so less room is left for\n",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data:"}]," at a given size) — a short code (a plain URL, a short id) is often the same\nsize at every level, but the difference shows up once the content pushes against a\nlevel's capacity. Worth raising for a code that'll be printed small or handled\nroughly, and safe to leave at the default otherwise."]}]
33:["$","h2","h2-2",{"id":"the-quiet-zone-lives-inside-the-box","aria-label":"The quiet zone lives inside the box","className":"group scroll-mt-24 mb-3 mt-10 border-b border-gray-800 pb-2 text-2xl font-bold text-white","children":["The quiet zone lives inside the box",["$","a",null,{"href":"#the-quiet-zone-lives-inside-the-box","aria-label":"Link to this section","className":"ml-2 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100","children":"#"}]]}]
34:["$","p","p-5",{"className":"my-4","children":["Every QR code needs a plain border — the ",["$","strong","strong-0",{"className":"font-semibold text-gray-100","children":"quiet zone"}]," — around the modules for a\nscanner to find it. ",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"size:"}]," is the side of the box you declare, and the quiet zone is\ndrawn ",["$","strong","strong-1",{"className":"font-semibold text-gray-100","children":"inside"}]," it, in ",["$","code","code-1",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"background:"}],", so an adjacent shape can never crowd a code's\nscan margin just by sitting close on the card. The box you draw is exactly the box a\nscanner sees."]}]
35:["$","h2","h2-3",{"id":"when-the-data-doesnt-fit","aria-label":"When the data doesn't fit","className":"group scroll-mt-24 mb-3 mt-10 border-b border-gray-800 pb-2 text-2xl font-bold text-white","children":["When the data doesn't fit",["$","a",null,{"href":"#when-the-data-doesnt-fit","aria-label":"Link to this section","className":"ml-2 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100","children":"#"}]]}]
36:["$","p","p-6",{"className":"my-4","children":["Every QR code has a capacity ceiling, set by ",["$","code","code-0",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"level:"}]," (higher levels hold less\ncontent at a given size) — a code has a limit past which no code can be built at all,\nno matter how large. ",["$","code","code-1",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data:"}]," that exceeds it is a ",["$","strong","strong-0",{"className":"font-semibold text-gray-100","children":"QR data is too long for one\ncode"}]," error, and the card renders as a placeholder, the same \"this one card's data\nwas the problem\" isolation every other data-time error gets — the rest of the deck is\nunaffected. An empty ",["$","code","code-2",{"className":"rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300","children":"data:"}]," is not this case: it encodes as a normal, valid, tiny\ncode — there's nothing special about zero-length data."]}]
37:["$","nav",null,{"className":"mt-14 grid gap-3 border-t border-gray-800 pt-6 sm:grid-cols-2","aria-label":"Page navigation","children":[["$","$L5",null,{"href":"/docs/images","className":"rounded-lg border border-gray-800 px-4 py-3 hover:border-gray-600 hover:bg-gray-800/40","children":[["$","span",null,{"className":"block text-xs uppercase tracking-wider text-gray-500","children":"← Previous"}],["$","span",null,{"className":"mt-1 block font-medium text-teal-400","children":"Images"}]]}],["$","$L5",null,{"href":"/docs/expressions","className":"rounded-lg border border-gray-800 px-4 py-3 text-right hover:border-gray-600 hover:bg-gray-800/40 sm:col-start-2","children":[["$","span",null,{"className":"block text-xs uppercase tracking-wider text-gray-500","children":"Next →"}],["$","span",null,{"className":"mt-1 block font-medium text-teal-400","children":"Expressions"}]]}]]}]
2a:[["$","meta","0",{"charSet":"utf-8"}],["$","meta","1",{"name":"viewport","content":"width=device-width, initial-scale=1"}]]
26:null
38:I[622,[],"IconMark"]
28:{"metadata":[["$","title","0",{"children":"QR codes — Card Goblin docs"}],["$","meta","1",{"name":"description","content":"The Qr element — scannable codes generated straight from sheet data."}],["$","meta","2",{"name":"application-name","content":"Card Goblin"}],["$","meta","3",{"name":"keywords","content":"board game design,print and play,card generator,custom playing cards,card game prototype,print-at-home PDF cards,tabletop game design tool"}],["$","meta","4",{"name":"robots","content":"index, follow"}],["$","link","5",{"rel":"canonical","href":"https://www.cardgoblin.com/docs/qr-codes"}],["$","meta","6",{"property":"og:title","content":"QR codes — Card Goblin docs"}],["$","meta","7",{"property":"og:description","content":"The Qr element — scannable codes generated straight from sheet data."}],["$","meta","8",{"property":"og:url","content":"https://www.cardgoblin.com/docs/qr-codes"}],["$","meta","9",{"property":"og:type","content":"article"}],["$","meta","10",{"name":"twitter:card","content":"summary_large_image"}],["$","meta","11",{"name":"twitter:title","content":"QR codes — Card Goblin docs"}],["$","meta","12",{"name":"twitter:description","content":"The Qr element — scannable codes generated straight from sheet data."}],["$","link","13",{"rel":"icon","href":"/icon.svg?5701f3d584d9a60c","type":"image/svg+xml","sizes":"any"}],["$","$L38","14",{}]],"error":null,"digest":"$undefined"}
2d:"$28:metadata"
