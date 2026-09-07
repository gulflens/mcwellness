# SPEC — The console on any screen (piece nineteen)

*Worktree: `trunk-35`, branch `responsive-console`. Shared zone: `app/shell/**`
and `index.html`, which is `main` only, plus the module stylesheets under
`app/admin/**` and `app/client/portal.css` whose own breakpoints this piece
withdraws. No entity, no migration, no API route. The four decisions of section 3
were taken by the operator late on 7 September 2026 and the design was
approved on 8 September 2026.*

Status: **approved for building, 8 September 2026**. The operator asked for a
console that adapts to the screen it is on, said the web app will be used on a
tablet or a laptop, and said that on a phone nothing should be crammed: the
page may be read in landscape, or as a zoomed-out page the person pinches and
pans. In a second instruction the same evening the operator asked that the
sidebar scroll on its own and open and close to make room for content.

---

## 1. Purpose

The console is a desk tool that is now opened on iPads and phones as well as
laptops, and it has one width breakpoint to its name. This piece gives it
three sizes it understands, a sidebar the person can put away, and a phone
treatment that shows the whole desk rather than a squeezed version of it.
Nothing about the practitioner's phone or the household's portal changes.

## 2. What exists on `main`, and what this adds

**Exists.** One breakpoint at 720px in `app/shell/shell.css`, three blocks
deep, described in `DESIGN.md` section "Layout". Above it every screen takes
the desk layout: a fixed 220px rail, 32px page padding, and content capped at
1200px. Below it the grid collapses to one column, the rail becomes a wrapping
band under a hairline, arriving sections and the roles line are hidden, and
the ledger pins its first two columns and scrolls inside its own container.
Five further breakpoints are written into module stylesheets, at 640px and
1100px in `app/admin/schedule/schedule.css`, 40rem in
`app/admin/settings/settings.css`, 48rem in `app/admin/audit/audit.css`,
720px in `app/client/portal.css`, and one `min-height` rule at 50rem in
`app/admin/clients/clients.css`.

**Measured on the seeded console, 7 September 2026**, at the browser widths
below. The figure is what a table hides inside its own scrolling container;
the page body itself never scrolls sideways at any width. The clients table
asks for 745px and stretches to fill anything wider; the kit register asks for
1271px at every width and so is the one table that scrolls even on a laptop.

| Screen | Content width | Clients hides | Kit hides |
|---|---|---|---|
| Phone portrait, 390 | 390 | 392px | 913px |
| Small tablet portrait, 768 | 548 | 261px | 787px |
| iPad portrait, 820 | 600 | 209px | 735px |
| Phone landscape, 844 | 624 | 185px | 711px |
| Small tablet landscape, 1024 | 804 | 5px | 531px |
| Laptop, 1440 | 1200, at the cap | none | 135px |

Two further faults were seen rather than measured. A phone in landscape is
844px wide and 390px tall, so it takes the desk layout and shows one and a
half rows of the table beneath a header sized for a desk. On a phone in
portrait the folded rail occupies about a third of the screen before the
heading begins, and the sign-out control runs to the edge.

**This piece adds** three layout tiers in place of the one breakpoint, a
sidebar that scrolls on its own and closes to a strip of icons, a desk-width
layout for the console on a phone, tables that pin and scroll whenever they
are too wide rather than only below 720px, and fluid sizes for the rail, the
drawer and the content cap. It withdraws the five module breakpoints into the
tiers, except the two that answer a real question of their own, named in
section 9.

## 3. The operator's four decisions

Taken on 7 September 2026, each with the recommendation accepted.

1. **On a phone the console is a zoomed-out desk view.** It lays itself out at
   a desk width and the browser scales the whole page to fit the screen; the
   person pinches to zoom and drags to pan. Nothing reflows and nothing is
   hidden. Text starts small, which is the accepted trade; what that costs in
   accessibility terms, and what a person who cannot work at that scale should
   do instead, is written down in `docs/COMPLIANCE/accessibility.md`.
2. **The closed sidebar is a strip of icons.** It starts closed on a tablet
   and a phone and open on a laptop, and the person's own choice is remembered
   on that device.
3. **A wide display is used for tables, not for prose.** Tables, the schedule
   and the books fill the display; paragraphs, consent wording and settings
   keep their 68-character measure.
4. **A table too wide for its space pins its first column and scrolls.**
   Every column stays reachable; no column is dropped and none is hidden. The
   operator chose this as "pin the first columns"; section 8 records why it
   became one column rather than two.

## 4. The three tiers

One vocabulary, three sizes, named in `app/shell/tokens.css` and nowhere else.

| Tier | Viewport width | Rail | Page padding | Content |
|---|---|---|---|---|
| Desk | 1200 and above | Open, labelled | 32px | Fills, capped per section 7 |
| Tablet | 768 to 1199 | Closed to icons by default | 24px | Fills |
| Compact | Below 768 | Closed to icons by default | 16px | Fills |

The tiers are expressed as two `@media (min-width: …)` boundaries in
`app/shell/shell.css` and referenced by every screen through the tokens they
set. No screen writes a width of its own; section 10's guard test proves it.

A phone reaching the console never renders the compact tier in practice,
because section 5 gives it a 1024px layout width, which is the tablet tier.
The compact tier is what a laptop window dragged narrow gets, and what the
console falls back to if the viewport module in section 5 does not run.

## 5. The console on a phone

**The mechanism.** `index.html` keeps
`width=device-width, initial-scale=1` as the document's own viewport, which is
what the sign-in page, the practitioner app and the portal need. A new shell
module, `app/shell/viewport.ts`, rewrites the `viewport` meta element's
`content` when the route area changes:

- an `/admin` route on a small-screened device sets `width=1024`;
- every other route, and every large-screened device, sets
  `width=device-width, initial-scale=1`.

With `width=1024` and no `initial-scale`, the browser lays the page out at
1024 CSS pixels and chooses the initial scale that fits it to the screen. The
result is the whole console, zoomed out, pinchable and pannable. Neither
`user-scalable=no` nor `maximum-scale` is ever written: zooming must never be
taken away.

**Small-screened is read from the device, not the viewport.**
`window.screen.width` reports the screen in CSS pixels and does not change
when the viewport meta does, so it cannot oscillate. A device is small-screened
when `window.screen.width < 768`. `window.innerWidth` must not be used for
this test, because setting the meta changes it and the condition would flip on
its own.

**Why 1024.** A 1024px layout leaves 912px of content once the closed rail
and the tablet tier's padding are taken off. The clients, books, billing,
schedule and portal-access tables each ask for less than that and so sit
whole. The kit register asks for 1271px at any width and so pins and scrolls
inside the zoomed-out page, exactly as it does on a laptop today.

**Testing.** The module reads its decision through a seam so a test can force
either answer without a device. `app/shell/viewport.ts` exports the pure
function that maps a route area and a screen width to a `content` string, and
the module that applies it to the document.

## 6. The sidebar

**It scrolls on its own.** `.rail__list` becomes the rail's only growing part
and takes `overflow-y: auto`. The wordmark stays at the block start and the
person's name and the sign-out control stay pinned at the block end, so a rail
longer than the screen can never push either out of reach. This is a fault
today at any height under about 640px, not only on a phone.

**It opens and closes.** A control at the block start of the rail, beside the
wordmark, toggles it. Closed, the rail is a 64px strip: the icons remain, the
labels, the "Arriving" markers, the person's roles and the wordmark's letters
do not. Every section keeps its accessible name through `aria-label`, and
shows its label on hover and on focus through the control's `title`. The
control itself is a `button` with `aria-expanded` and a stable accessible
name, "Sections".

**The default follows the tier; the choice beats the default.** Open on the
desk tier, closed on the tablet and compact tiers. The person's own choice is
written to `localStorage` under `mcwellness.rail`, read once at boot, and
applied at every tier until they change it again. A browser that refuses
storage falls back to the tier's default and the console still works.

**This reverses a line in the design brief.** `docs/DESIGN-BRIEF.md` section
6.2 pins the rail as "fixed left rail (icon + label, no collapse toggle)". The
operator asked for the toggle on 7 September 2026. The brief and `DESIGN.md`
are both edited in this piece so that no two documents disagree, and the
reversal is recorded with its date and its reason rather than made silently.

## 7. Fluid sizes in place of fixed ones

`app/shell/tokens.css` gains the sizes below and the layout stops writing
pixels of its own.

| Token | Value | What it is |
|---|---|---|
| `--rail-open` | `220px` | The labelled rail, unchanged |
| `--rail-closed` | `64px` | The icon strip |
| `--rail` | one of the two | Set by the tier and the person's choice |
| `--drawer` | `clamp(320px, 55vw, 480px)` | Never more than a little over half the screen, so the ledger stays readable beside it |
| `--content-max` | `1600px` | The cap for tables and the wide screens |
| `--measure` | `68ch`, unchanged | The cap for prose |

The content cap rises from 1200px to 1600px and applies to `.admin__main`.
Prose keeps `--measure`, so a paragraph on a 1920px display is still 68
characters wide while the table beside it is not. Screens that are prose
rather than data, chiefly Settings and the consent wording, keep the measure
for their body and take the wider column only for anything tabular.

The drawer's `clamp` replaces the fixed 480px. On an 820px tablet it becomes
451px and the ledger keeps 369px beside it; on a laptop it stays 480px. On the
compact tier the existing rule stands unchanged and the drawer takes the full
width with no edge hairline, so the clamp's 320px floor is never what a narrow
screen sees.

## 8. Tables

The behaviour that lives below 720px today becomes the behaviour whenever a
table is wider than the space it has, at any size:

- the first column, the one that says which row this is, is pinned on the
  inline start and draws an inset hairline on its end edge;
- the rest scrolls inside `.ledger__scroll`, never the page body;
- the pinned column takes the paper ground so rows do not show through.

**One column, not the two the 720px rule pinned.** A second sticky column has
to be offset by the first one's width, and CSS cannot read that. The rule it
replaces assumed 7.5rem, which is true of a record number and false of the kit
register's serial: making the rule unconditional showed the two columns
overlapping there as soon as the row scrolled. Pinning the identifying column
alone is correct for every table and needs nothing measured. The clients
ledger loses nothing in practice, because at the tablet tier it now hides 37px
rather than 209px and the name is on screen without scrolling at all.

Pinning is unconditional rather than driven by a width query. A sticky column
in a container it already fits inside has nothing to stick to and no visible
effect, so the rule can simply always apply and no JavaScript needs to measure
anything. This also removes the present dependence on the viewport width,
which is the wrong question: what matters is the table against its container,
not the table against the screen. `app/shell/components/Table.tsx` carries the
class so every screen built on it inherits the behaviour.

The page body must never scroll sideways at any tier. Section 10's test proves
it at each of the seven widths.

## 9. Module stylesheets

The five module breakpoints are withdrawn into the tiers, except two that ask
a question the tiers do not answer and which stay with a comment saying so:

| File | Rule | Becomes |
|---|---|---|
| `app/admin/schedule/schedule.css` | 640px, week to one column | The compact tier |
| `app/admin/schedule/schedule.css` | 1100px, the week's aside stands down | Stays: it is about seven columns of content, not the tier |
| `app/admin/settings/settings.css` | 40rem, facts to one column | The tablet tier |
| `app/admin/audit/audit.css` | 48rem, the event grid narrows | The tablet tier |
| `app/admin/clients/clients.css` | 50rem min-height, a taller consent | Stays: it is about height, not width |
| `app/client/portal.css` | 720px, the portal's own phone layout | Stays exactly as it is |

`tests/scheduling/WeekPage.test.tsx` asserts the week's fold by reading the
stylesheet for a `max-width` rule; it is updated to read the tier instead.

## 10. Tests

- `app/shell/viewport.test.ts`: the pure mapping. An `/admin` route on a
  390px screen gives `width=1024`; on a 1440px screen it gives
  `width=device-width, initial-scale=1`; a `/today` route and a portal route
  give the device width at every screen size; no answer ever contains
  `user-scalable` or `maximum-scale`.
- `app/shell/components/Rail.test.tsx`: the toggle's accessible name and
  `aria-expanded`; every section keeps its accessible name when closed; the
  person's choice is read from and written to storage; a storage that throws
  falls back to the tier default.
- `tests/lint/one-set-of-breakpoints.test.ts`: no stylesheet under `app/`
  declares a `min-width` or `max-width` media query except
  `app/shell/shell.css` and the three files section 9 exempts by name. This is
  the guard that keeps a sixth breakpoint from appearing quietly.
- `tests/lint/layout-tokens.test.ts`: reads `app/shell/shell.css` and asserts
  the two tier boundaries are 768px and 1200px and are written as
  `min-width`, that the console's grid uses `minmax(0, 1fr)` for its content
  column, which is what keeps a wide table inside its own scroller instead of
  pushing the page sideways, and that no rule sets `user-scalable` or
  `maximum-scale`.

Real layout cannot be measured in the test environment: jsdom computes no
widths, so a test that mounted the console at seven viewport sizes would
assert nothing. The widths of section 2 are checked in a browser instead, as
part of the staging pass, and the figures in this specification came from that
same measurement on 7 September 2026.

`pnpm verify` must pass. The `no-hex-colour` and `no-design-tells` rules apply
to every file this piece touches.

## 11. What does not change

- The practitioner app. Dark, one column, device width, 48px targets. It is
  correct today and this piece does not touch `app/therapist/**`.
- The client portal. It keeps its own 720px phone layout, because a parent
  reading it at night should not have to pinch and pan. It gains only the
  fluid drawer and the tokens.
- The sign-in page. Device width, one centred column, comfortable on a phone.
- The ledger's vocabulary. Rows stay 44px, rules stay hairlines, hue stays
  reserved for the bands and the three status states, and there is still no
  accent colour.

## 12. Decisions this specification takes

Each is Claude's default and the operator may overrule any of them.

1. The desk width on a phone is 1024px, for the reason in section 5.
2. The tier boundaries are 768px and 1200px, the two places the measurements
   of section 2 change character.
3. The content cap rises to 1600px rather than being removed, so a very wide
   display does not stretch a table to an unreadable line length.
4. The closed rail keeps icons rather than disappearing, which the operator
   chose in section 3, and the toggle sits beside the wordmark rather than
   floating over the content.
5. The person's choice is remembered per browser in `localStorage`, not per
   account on the server. Nothing personal is stored; the key holds one word.
6. The compact tier is kept even though a phone will not normally see it,
   because a laptop window dragged narrow must still work and the viewport
   module must have something to fall back to.
