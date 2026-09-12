# SPEC — The practice's own colour, and the shell that carries it (piece twenty)

*Worktree: `brand`, branch `coloured-console`. Shared zone: `app/shell/**` and
`index.html`, which is `main` only, plus `app/client/portal.css` and the
practitioner's stylesheets under `app/therapist/**`. No entity, no migration,
no API route. The five decisions of section 3 were taken by the operator on
8 September 2026.*

Status: **drafted 8 September 2026, awaiting the operator's review.** The
operator asked for the practice's logo in the interface, for the console to use
the whole width of a desktop display rather than stopping short of it, for the
sidebar to stay on the inline start at every size with a way to collapse,
expand and pin it, and — in a second instruction the same afternoon — for "a
more attractive simple coloured design" in place of the colourless one. Asked
how far the colour should reach, the operator answered: everywhere.

---

## 1. Purpose

The console was built achromatic on purpose. Hue was reserved for the five EEG
bands and the three status states so that a colour on a screen always meant
something measured. That restraint is worth keeping where it earns its place —
inside a chart — and it has stopped earning its place everywhere else: the
practice has an identity of its own, an inherited violet carried from the QEEG
report tool and already printed on every invoice, and none of it reaches the
screen the practice is actually run on.

This piece gives the interface the practice's colour, puts the practice's mark
where a person can see it, lets the console fill the display it is opened on,
and makes the sidebar work on a phone rather than only survive there.

## 2. What exists on `main`, and what this changes

**Exists.** `app/shell/tokens.css` holds every colour the app may use: two
neutral families, five band hues, three status hues, and no accent. `DESIGN.md`
calls this the Silent Chrome Rule. `CLAUDE.md` records the violet's status as
undecided — *"Whether the inherited McWellness violet is an accent is an open
decision (PRODUCT.md, Brand Commitments); until it is taken, there is no accent
colour."* `PRODUCT.md` says the same and adds *"Recorded here, not resolved
here."* The rail carries the word "McWellness" set in the interface typeface;
the mark itself appears nowhere in the app. The console's content is capped at
1600px. A phone reaching `/admin` is served a 1024px layout and zoomed out.

**This piece adds** an accent family sampled from the mark, a coloured rail,
the mark itself in four places, a sidebar with three states rather than two, a
console that fills any display, and a phone that lays the console out at its
own width. It withdraws the 1024px phone treatment and the content cap.

**It reverses three written decisions.** Each is rewritten where it stands,
with its date and its reason, rather than quietly deleted:

| Reversed | Written at | Why |
|---|---|---|
| No accent colour in the interface | `DESIGN.md` "The Silent Chrome Rule", `CLAUDE.md` line 34, `PRODUCT.md` Brand Commitments | The open decision has been taken: the violet is an accent |
| The console on a phone is a zoomed-out desk | `docs/SPEC/responsive-console.md` section 3 decision 1, section 5 | The sidebar must work on a phone, which a zoomed-out page cannot do |
| Content capped at 1600px | `docs/SPEC/responsive-console.md` section 3 decision 3, section 7 | A desktop display should be used, not left half empty |

The reversal of the phone treatment is the largest of the three, because
`responsive-console.md` section 4 says plainly that "a phone reaching the
console never renders the compact tier in practice". After this piece it always
does. The compact tier was built and never exercised; section 8 says what that
costs.

## 3. The operator's five decisions

Taken on 8 September 2026, each with the recommendation accepted.

1. **The console lays itself out at the phone's real width.** Text is readable
   without pinching and the sidebar is usable. This retires the zoomed-out
   treatment.
2. **An expanded sidebar covers the content; pinning makes it push.** The icon
   strip is always on the inline start. Expanding floats the labels over the
   page; tapping a section goes there and closes. Pinning keeps it open across
   navigation and reloads, and where there is room it becomes a column again.
3. **The mark is full colour, and the violet is a real accent** — not a tinted
   logo in an otherwise grey interface, and not confined to the mark.
4. **The console fills any display.** No cap. Prose keeps its own measure.
5. **The colour reaches everywhere**: the console, sign-in, the household's
   portal and the practitioner's app.

## 4. The palette

Every value is sampled from `Documents/logo.png` — 1794 by 876 with
transparency, supplied by the operator on 8 September 2026 — not chosen. The
sampling, by share of opaque pixels:

| Region | Colour | Share |
|---|---|---|
| The wordmark's letters | `#340470` | 50.3% of that region |
| The circular mark's ground | `#380474` | dominant |
| The brain, saturated pinks | `#d81c7c` – `#e01c7c` | accents |
| The brain, mid purples | `#7c1c98` – `#9c2094` | accents |
| The linework | `#fcfcfc` | — |

`#380473` is therefore a faithful sample of the mark's own circle, and it is
already the brand violet named in `docs/SPEC/billing.md` section 5.6 and drawn
on every invoice and receipt by `domain/billing/document/render.ts`. **The
interface takes the same value.** One violet, one practice, one place it is
written down.

`app/shell/tokens.css` gains six tokens. Their hue is the mark's own, 268
degrees; nothing here is invented but the lightness steps.

| Token | Value | What it is |
|---|---|---|
| `--brand` | `#380473` | The practice's violet. Actions, links, the active state's text |
| `--brand-deep` | `#2b0359` | The rail's ground |
| `--brand-lift` | `#480594` | Hover within the rail |
| `--brand-pale` | `#eadff6` | A resting label on the rail |
| `--brand-wash` | `#f6f1fb` | A selected row, a tinted field |
| `--brand-magenta` | `#d81c7c` | The brain's pink. Reserved; see section 12 |

### 4.1 Contrast, measured

WCAG AA asks 4.5:1 of text and 3:1 of a control's boundary. Every pairing this
piece introduces was computed before it was written down, not after:

| Pairing | Ratio | Needs |
|---|---|---|
| White label on `--brand-deep` | 16.67 | 4.5 |
| `--brand-pale` label on `--brand-deep` | 13.00 | 4.5 |
| White pill on `--brand-deep` | 16.67 | 3.0 |
| `--brand` text on that white pill | 14.65 | 4.5 |
| `--brand` text on `--paper` | 12.98 | 4.5 |
| White on a `--brand` button | 14.65 | 4.5 |

### 4.2 Why the active section is a white pill and not a tinted row

Every violet ground that could mark the active section was measured against
the rail and every one failed. `--brand-lift` reaches 1.37 against
`--brand-deep`; `#6007c5` reaches 1.85; white laid over the rail at 10, 14, 18
and 24 per cent reaches 1.26, 1.42, 1.62 and 1.99. The floor is 3.0. **On a
dark ground, tinting a row cannot carry a state**, and no amount of choosing
between violets fixes it.

The rule already in `shell.css` is the right one and needs only the new
palette. `.rail__item--active` is `background: var(--surface)` today — a white
pill. On the violet rail that is 16.67 against the ground, with `--brand` text
on it at 14.65. The state is unmistakable and the markup does not change.

### 4.3 The dark ground

`#380473` on the practitioner's `--paper` of `#10191d` is 1.22 — invisible.
The band colours already solve this problem by lifting under
`[data-ground='dark']`, and the brand takes the same treatment. Mixing towards
white passes the contrast floor at 45 per cent but yields `#a58ec0`, a
desaturated lilac that no longer reads as the practice's colour. Raising
lightness while holding saturation gives a violet that is both legible and
recognisable:

| Candidate | On `#10191d` | On `#16242a` | Dark text on it |
|---|---|---|---|
| `#a58ec0` — 45% towards white | 6.13 | 5.48 | 6.13 |
| **`#a96cef` — L 68%, S 80%, hue held** | **5.16** | **4.61** | **5.16** |

`--brand: #a96cef` under `[data-ground='dark']`. It passes AA in both
directions, so one token serves a link on the dark ground and a filled control
with dark text on it, and it still reads as violet.

**`--brand` is the only one of the six the dark ground overrides.** The other
five describe a rail that the practitioner's app does not have and grounds it
does not use, and a token redefined where nothing reads it is a trap for the
next person. If a later piece gives the dark ground a surface that needs one,
it is added then, with its own measurement.

## 5. The rail

Ground `--brand-deep`. Resting labels and icons `--brand-pale`; the label of
the section you are on is `--brand` on a white pill. Hover is `--brand-lift`.
The separators within the rail are white at 18 per cent: visible, decorative,
and carrying no contrast duty because nothing is read from them.

**One correction the measurements forced.** The roles line beneath the person's
name renders at `--slate` today. Its violet equivalent, `#9b69d3`, measures
4.25 against the rail and **fails**. It takes `--brand-pale` like every other
label, and is separated by size rather than by colour.

## 6. The mark

The supplied file divides cleanly. Measured from the alpha channel's column
profile:

| Piece | Pixels in source | Aspect |
|---|---|---|
| The circular mark | 638 × 681, at x 33–671 | 0.94, near-square |
| Wordmark, tagline and pulse | 1072 × 724, at x 689–1761 | 1.48 |

**Two assets, cut from the one file**, under `public/brand/`:

| Asset | Crop | Shipped at | Budget |
|---|---|---|---|
| `mark.png` | (33, 129) – (671, 810) | 384px wide | ≤ 40KB |
| `lockup.png` | (33, 95) – (1761, 819) | 960px wide | ≤ 120KB |

If PNG cannot meet a budget, the asset ships as WebP with a PNG fallback
through `<picture>`. `docs/brand-assets.md` records the source file, the date
the operator supplied it, and these crop boxes — kept in `docs/` rather than
beside the files, because everything in `public/` is served and a provenance
note is not a page on the practice's domain — so a later cut can be
reproduced rather than guessed — the same habit `public/icon.svg` and
`public/manifest.webmanifest` already keep for their copied token values.

**PNG, not traced to SVG.** The brain is a dense node-and-edge illustration
over a gradient. Tracing it produces a large file that is subtly wrong in the
places the eye goes first. A raster cut at three times its largest use is
sharper on every display the practice owns, and that is what "a good quality
logo" means here.

**Where it appears, and in which form:**

| Place | Form | Size |
|---|---|---|
| Rail, expanded | Mark, with "McWellness" in the interface typeface, white | 36px |
| Rail, closed to a strip | Mark alone, centred | 32px |
| Sign-in | The full lockup | ~320px wide |
| The household's portal header | Mark, with the practice's name | 32px |
| The practitioner's Today landing | Mark on a white plate — see below | 40px |

**The rail shows the mark, not the lockup.** The wordmark piece is 1.48:1
*including* "MIND • BALANCE • HEALING" and the pulse rule beneath it. At the
150 pixels the rail could give it, the tagline degrades to grey noise and the
script fights IBM Plex two lines below. The mark beside the name in the
interface's own typeface is the arrangement that keeps the logo looking
deliberate. The lockup is shown whole where there is room for it: sign-in, and
the documents, where it already is.

**On the dark ground the mark sits on a white circular plate.** The mark's own
circle is `#380473`, which is 1.22 against `#10191d` — the disc would vanish
and leave the linework floating. The plate is a decision to look at rather than
assume; both it and the bare mark are to be put side by side on the
practitioner's landing before this piece is called done.

## 7. The sidebar

Three states where there were two, and a tier decides which are reachable.

| | Compact, below 768 | Tablet, 768–1199 | Desk, 1200 and up |
|---|---|---|---|
| Resting | 64px strip | 64px strip | Open, labelled column |
| Expanded | Covers, scrim behind | Covers, scrim behind | Already open |
| Tapping a section | Goes, and closes | Goes, and closes | Goes, and stays |
| Pinned | Stays open, still covers | Becomes a column, pushes | Not offered |

**Why pinning does not push on a phone.** A 220px rail on a 390px screen
leaves 170px of page. Pinning there means only that the sidebar stops closing
itself, which is what a person pinning it on a phone actually wants.

**The state is two remembered facts, not one.** `mcwellness.rail` already holds
`open` or `closed` and keeps its meaning. A second key,
`mcwellness.rail.pinned`, holds `yes` or `no`. No migration is needed and a
browser that refuses storage falls back to the tier's default, as it does now.

**The mode is derived, never stored.** A pure function in `app/shell/railState.ts`
maps a tier and the two facts to one of `column-open`, `column-strip` or
`overlay`, so every combination can be tested without a browser:

- desk → `column-open` when open, `column-strip` when not; pinned is ignored;
- tablet and pinned and open → `column-open`;
- open → `overlay`;
- otherwise → `column-strip`.

**What an overlay owes a person.** It closes on Escape and on a press outside
itself, unless pinned. While it covers, focus is held within it and returns to
the toggle when it closes. The scrim is `--ink` at low opacity and is not
announced. The slide takes `--motion`, which `prefers-reduced-motion` already
sets to zero. The rail enters from the inline start, so the Arabic edition
mirrors without a second rule — `@starting-style` for the drawer in
`shell.css` is the pattern to follow.

**The pin control** sits beside the existing toggle in `.rail__head`, and only
where it means something: below the desk tier, and only while the rail is
expanded. It is a `button` with `aria-pressed` and the accessible name "Keep
sections open". The strip shows the toggle alone; there is no room for two
controls in 64px and nothing for the second to do.

### 7.1 The pages under a section

*Added 2026-09-12 on the operator's instruction: "the sub menu in schedule,
billing and books to be as well visible in the sidebar… once I click one of
these, I need the submenu to expand and show underneath as well, keep the
current layout in addition to the sidebar submenu." Settings was added to the
three at the same time, on the operator's answer.*

Four sections hold more than one page, and each lists its pages in the rail
beneath itself:

| Section | Pages |
|---|---|
| Schedule | Day, Week, Board, Day map |
| Billing | Prices, Packages, Balances, Invoices, Receipts |
| Books | Overview, Journal, Accounts, Statements, Books settings |
| Settings | Practice, Practitioners, Team |

**The list showing is the list of the section you are on.** Choosing Billing
goes to Billing and opens its pages; leaving for Books closes Billing's and
opens Books'. Nothing is remembered and nothing is stored: the open list is
derived from the address on every render, so the rail cannot come to disagree
with the page standing beside it, and there is no third remembered fact after
`mcwellness.rail` and `mcwellness.rail.pinned`.

**The page's own tabs stay exactly as they are.** The rail is a second door
into the same views, not a replacement for the row of tabs on the page. That
was the operator's instruction in as many words.

**Which row is marked.** `NavLink` decides from the path alone, and Billing and
Books hold their sections after a hash — every row of those two would be marked
at once. `childIsCurrent` (`app/shell/railChildren.ts`) reads the hash as well,
and when the address names none it marks the section's first page, because that
is the one those pages open on.

**A page the reader may not open is not listed**, which is the promise the rail
has always made one level up. The board is asked of `appointment.board.read`,
its own rule; Settings' three are asked of the same rules `SettingsNav` asks on
the page. Billing's and Books' pages are not asked about separately: each of
those sections is one screen behind one rule.

**The day map is a plain anchor**, as the Schedule header's link to it is: it
is served as its own document with the wider content security policy a browser
map needs (`docs/SPEC/route-planning.md` section 4.1).

**On the strip there is nothing to draw.** A page row is a label and no icon,
and 64px holds no labels, so the list is not drawn there at all. It returns
wherever the labels do, including when the rail covers the page on a tablet or
a phone — where choosing a page closes the rail behind you, exactly as choosing
a section does.

**The look.** A page row is indented to line its label up with its section's
label, takes the rail's own `--brand-pale` at `--t-small`, and the row you are
on takes the same white pill the current section takes, for the same measured
reason (section 4.2). The rail's list already scrolls, so a tall section costs
the rail nothing.

### 7.2 The page's own switcher

*Added 2026-09-12 on the operator's instruction: "make it look like tabs or
buttons and make the active 1 inherit the violet color." They chose buttons
from three variants shown in a browser.*

Four screens carry a switcher above their content, and all four now look the
same: Billing's and Books' sections, Settings' three screens, the client
record's tabs, and the schedule's other views (the week, the board, the day
map). A resting one is a white button with a hairline border; hover turns the
border and the text violet; **the one you are on is filled `--brand` with white
text**.

**Why a violet fill is allowed here and refused on the rail.** These sit on the
page's light paper, where white on the brand's violet measures **14.65**. The
rail's own ground is what refuses a violet state — every candidate measured
between 1.14 and 1.99 against `--brand-deep`, under a floor of 3.0 (section
4.2) — so the rail keeps its white pill and this is not a precedent against it.

**One definition, in `app/shell/shell.css`.** It was four copies of one
quiet-words-with-a-rule pattern, in `billing.css`, `settings.css`,
`clients.css` and `schedule.css`. Screens are code-split (PR 152), and
`BooksPage` renders `.sections` while importing only its own stylesheet — so a
reader who opened Books **without having opened Billing first** got five
unstyled browser buttons. Measured in a browser on 12 September 2026: on a
fresh load of `/admin/books`, no stylesheet in the document defined
`.sections__tab` at all. The rules now live in the stylesheet `main.tsx` loads
at start-up, which no split can strand, and
`tests/lint/tabs-are-always-styled.test.ts` refuses any other home for them.

**The hairline under the strip is gone**, and the height is the console's own
44px row. The rule separated a row of quiet words from the content beneath it;
a row of buttons carries its own edges, and a line as well reads as a second and
emptier border. 44px is what the compact-tier walk of 9 September 2026
prescribed when it measured the settings strip at 35px; the 48px floor is the
practitioner app's.

**The schedule's three ways through stay links** — they go somewhere, and the
sidebar lists the same views (section 7.1) — but they wear the switcher's look
and drop the underline, so the page does not carry two vocabularies for the
same act.

## 8. The console on a phone

`app/shell/viewport.ts` and its test are deleted, and `index.html` keeps the
one static viewport it declares today. Nothing rewrites the meta element any
more. The guard that forbids `user-scalable=no` and `maximum-scale` anywhere in
the app stays exactly as it is; the exemption that module needed goes with it.

**What this costs.** The compact tier stops being theoretical. Every console
screen must genuinely work at 390px, and each is to be opened at that width and
looked at: clients, schedule, billing, books, audit, settings, portal access
and kit. Three things already in place mean this is a review rather than a
rebuild — tables pin their identifying column and scroll inside their own
container at any width, a toolbar field takes the whole line below 768px, and
the drawer takes the full width with no edge hairline. The work is to find what
those three do not cover.

## 9. The full width

`max-inline-size: var(--content-max)` is removed from `.admin__main` and
`--content-max` is deleted from `tokens.css`, because a token nothing reads is
a trap for the next person. `shell.css` line 31 is its only reader, checked
rather than assumed. Prose keeps `--measure` at 68 characters through its own
rules — nine of them, across the shell, settings, assessments, reports and the
portal, none of which this piece touches — so a paragraph does not stretch when
a table does.

On a 2056px display the ledger goes from 1600px to 1836px and the empty paper
on the inline end is gone.

## 10. Colour beyond the console

| Surface | What changes |
|---|---|
| Sign-in | The lockup at ~320px in place of the text mark; the door button in `--brand`; the focus ring in `--brand` |
| The household's portal | The mark in the header; links and the primary action in `--brand`; grounds unchanged, because the portal is calm by brief |
| The practitioner's app | `--brand` resolves to `#a96cef` under `[data-ground='dark']`; it is taken by the 56px primary action in the thumb zone and by the focus ring, and by nothing else; **the ribbon, the offline band and every band figure are untouched** |

The portal keeps its generous single column and its measure. Colour arrives
there as the practice's identity, not as decoration.

## 11. What does not change

The five band hues and the three status colours keep their values exactly.

**The rule that keeps them meaningful:** the brand violet never enters a
chart's plotting area, and no band hue is ever used for chrome.

The nearest collision was checked rather than assumed. `--delta-base` is
`#3b4a87`, an indigo, and measures 1.76 against `--brand` — close in hue and
close in lightness. It is safe because the two never meet: delta appears only
inside a labelled chart, and the violet appears only in the rail, on actions
and on links. Section 12 makes that a test rather than a promise.

## 12. Guards

The existing guards must all still pass: `layout-tokens`, `no-hex-colour`,
`one-set-of-breakpoints`, `console-is-english`. Four are added.

1. **Colour keeps its meaning.** No file that uses a band token may use a
   `--brand` token, and no shell stylesheet may use a band token. Band tokens
   appear today in exactly two module stylesheets, `assessments.css` and
   `reports.css`, plus `tokens.css`; the test reads the tree and asserts the
   partition rather than naming the files.
2. **Every pairing still passes.** The contrast ratios of section 4.1 and 4.3
   are computed from the token values themselves in a unit test, so changing a
   token to something illegible fails the build instead of shipping.
3. **The sidebar's modes.** The pure function of section 7 is tested at every
   combination of tier, open and pinned, including the ones a person cannot
   reach by pressing things.
4. **`--brand-magenta` is reserved.** It is declared and, for now, used
   nowhere. The test asserts that: a colour with no use yet should not acquire
   one by accident. It exists so the mark's second hue is written down in the
   same place as the first.

The seven-width sideways-scroll check of `responsive-console.md` section 10
stays and now means more, because a phone genuinely renders the compact tier.

## 13. Files and ownership

`app/shell/**` and `index.html` are a shared zone under
`docs/SPEC/OWNERSHIP.md`. This piece is accompanied by a change request in
`docs/CHANGE-REQUESTS/`, per `CLAUDE.md` rule 10.

Touched: `app/shell/tokens.css`, `shell.css`, `base.css`, `AdminLayout.tsx`,
`railState.ts`, `components/Rail.tsx` and their tests; `app/shell/viewport.ts`
and its test, deleted; `app/client/portal.css`; the practitioner's stylesheets
under `app/therapist/**`; `public/brand/` as a new directory; `index.html`.
Rewritten to record the reversals: `DESIGN.md`, `CLAUDE.md`, `PRODUCT.md`,
`docs/DESIGN-BRIEF.md`, `docs/SPEC/responsive-console.md`.

## 14. Out of scope

- The PWA icon and the manifest's colours. `public/icon.svg` is the
  practitioner app's achromatic glyph and its own question; changing it changes
  what is already on a home screen.
- The practice logo held in the database (migration `909_practice_logo.sql`)
  and drawn on invoices. That is a *practice's* uploaded logo and stays as it
  is. The rail's mark is the product's own, bundled, because it must render
  before a practice has loaded and on the sign-in page where none has.
- The website at mcwellnessuae.com.
- Arabic wording. Layout is mirrored by logical properties as it already is;
  no copy is added by this piece.
