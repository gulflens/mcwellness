---
name: McWellness
description: A calm instrument for a home-visit wellness practice. Violet chrome, white working surfaces on violet-cast paper, IBM Plex Sans, and one bold figure, the session ribbon, that makes a client's programme visible.
colors:
  ink: "#1f152b"
  ink-2: "#4a4056"
  slate: "#756c81"
  rule: "#d0cbd6"
  paper: "#e9e7ec"
  surface: "#ffffff"
  brand: "#380473"
  brand-deep: "#2b0359"
  brand-lift: "#480594"
  brand-pale: "#eadff6"
  brand-wash: "#f6f1fb"
  ok: "#2f6b4f"
  attention: "#8a6a1e"
  critical: "#94382e"
  delta: "#3b4a87"
  theta: "#2c7387"
  alpha: "#3d8557"
  beta: "#b8863a"
  gamma: "#a8553f"
  ink-dark: "#f0edf3"
  ink-2-dark: "#ccc6d4"
  slate-dark: "#9990a5"
  rule-dark: "#342a42"
  paper-dark: "#150f1e"
  surface-dark: "#1f162a"
  brand-dark: "#a96cef"
  ok-dark: "#5f9f83"
  attention-dark: "#c0a04e"
  critical-dark: "#c9705f"
typography:
  display:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: "44px"
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "31px"
    fontWeight: 500
    lineHeight: "38px"
    letterSpacing: "-0.015em"
  h2:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: "32px"
  h3:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: "28px"
  body:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "26px"
  small:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  micro:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  numeric:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontFeature: "'tnum' 1, 'lnum' 1"
rounded:
  r-1: "2px"
  r-2: "6px"
  r-3: "10px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-8: "32px"
  s-10: "40px"
  s-12: "48px"
  s-16: "64px"
motion:
  control: "120ms"
  motion: "160ms"
  ribbon: "400ms"
  ease: "cubic-bezier(0.2, 0, 0, 1)"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.brand-lift}"
    textColor: "{colors.surface}"
  button-primary-active:
    backgroundColor: "{colors.brand-deep}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.critical}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 12px"
    height: "44px"
  rail:
    backgroundColor: "{colors.brand-deep}"
    textColor: "{colors.brand-pale}"
    width: "220px"
  rail-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.r-3}"
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.small}"
    height: "44px"
  table-cell:
    textColor: "{colors.ink}"
    padding: "0 12px"
    height: "44px"
  drawer:
    backgroundColor: "{colors.surface}"
    width: "480px"
---

# Design System: McWellness

## Overview

**Creative North Star: "The Calm Instrument"**

McWellness is a wellness practice whose product reads as measurement: closer to a well-made laboratory instrument than to a spa, and closer to that than to a spreadsheet. The person using it should feel that the practice is careful, precise and quietly expensive. Three things carry that feeling, in this order:

1. **One focal point per screen.** Every screen answers one question first and visibly: the client's next visit and progress on a record, the day's route on Today, what is owed on Billing. Everything else steps back.
2. **One bold figure.** The session ribbon (`docs/DESIGN-BRIEF.md` section 5) is where the product spends its boldness: a client's whole programme as one strip, on the client's home screen, beside every client in the console, and on the report cover. Restraint everywhere else exists to frame it.
3. **Finish.** White working surfaces with real depth, figures large enough to read across a room, controls that ease rather than flip, loading that holds the page's shape, and an ending with weight after every high-stakes action.

The chrome carries the practice; the figures carry the data. The practice's violet, `#380473`, sampled from its mark and printed on every invoice, is the single accent: the rail's ground, the one primary action, links, the selected section and the focus ring. Inside a figure, colour is signal only, the five EEG bands and three status states. The two never meet (the Separation Rule).

**Three grounds, one token set.** The console (light, the admin desk) is the reference surface. The instrument (dark, `[data-ground='dark']`, the practitioner's phone) inverts ink and paper, lifts bands, status and brand, and steps every type size up one so it reads at arm's length in a dim room. The record (light, calm, the household's portal) uses the same tokens at a 68-character measure and low density.

The history of how this system got here (the achromatic "Silent Ledger" of 2 September, the violet of 8 September, and this reframing on 18 October) is in `docs/ADR/0004-calm-instrument.md`. This document describes what is true now.

**Key characteristics:**
- Violet chrome, violet-cast neutrals, one accent.
- White working panels on paper: lists, records and forms sit on a surface, not on the ground.
- Display-size figures where a number or a name is the point of the screen.
- The session ribbon as the product's signature, in colour, because it is data.
- Short, quiet motion that answers an action; never choreography.
- Loading holds the layout's shape; high-stakes actions end on a confirmation, not a line of text.
- One family (IBM Plex Sans and Plex Sans Arabic), tabular figures, logical properties throughout.

## Colors

Every value lives in `app/shell/tokens.css`; the lint rule `mcwellness/no-hex-colour` refuses a literal anywhere else.

### Neutral (within 30 degrees of the mark's hue; `tests/lint/neutrals-share-the-hue.test.ts`)
- **Ink** `#1f152b`: primary text and the secondary button's border. Tinted, never `#111`.
- **Second ink** `#4a4056`: labels, table headers, counts, notes, placeholders, metadata. The lowest tone allowed for running text.
- **Slate** `#756c81`: marks only (the default status dot, a dimmed chevron). Never text.
- **Rule** `#d0cbd6`: every hairline: table rules, field borders, panel edges, the drawer's edge.
- **Paper** `#e9e7ec`: the app's ground, behind the panels.
- **Surface** `#ffffff`: panels, inputs, secondary buttons, the drawer, table headers on a panel.
- Hover and pressed tints are `color-mix` of ink at 4%, 6% and 10% over surface, so they follow the ground.

### Brand
- **Brand** `#380473`: the primary action, links, the selected section, the focus ring.
- **Brand deep** `#2b0359`: the rail's ground; the primary button pressed.
- **Brand lift** `#480594`: the primary button and rail items under the pointer.
- **Brand pale** `#eadff6`: text on the rail.
- **Brand wash** `#f6f1fb`: a selected tab or section, a consent reading surface, an activation area.
- **Brand magenta** `#d81c7c`: the mark's second colour, written down and unused; a guard test keeps it unused. The calm instrument does not need it.
- On the dark ground the brand lifts to `#a96cef` (5.16 against that ground). `tests/lint/brand-contrast.test.ts` computes every pairing.

### Status
Desaturated so it never competes with band data, and always carried beside a word.
- **Ok** `#2f6b4f`, **Attention** `#8a6a1e`, **Critical** `#94382e`. Critical is also the danger button and an error line.

### Band spectrum
Slow to fast, cool to warm: **Delta** `#3b4a87`, **Theta** `#2c7387`, **Alpha** `#3d8557`, **Beta** `#b8863a`, **Gamma** `#a8553f`, each with a `-tint` (12% over paper) and a `-deep` (80% toward black). Used by the session ribbon, assessment and report figures, and protocol chips.

### Named rules
**The One Accent Rule.** The violet is the only accent. Any colour on a screen is the brand, a band, a status or a neutral; anything else is wrong.

**The Separation Rule.** The brand never enters a chart's plotting area and no band hue is ever chrome (`tests/lint/colour-keeps-its-meaning.test.ts`).

**The Status-in-Words Rule.** Status is a word in ink with an 8px dot beside it carrying the hue. The word is never coloured and never sits on a pill.

**The Ground Swap Rule.** Dark is a ground, set by `data-ground='dark'` on the surface that needs it. It swaps every token at once; no component is restyled for dark.

## Typography

**One family:** IBM Plex Sans with IBM Plex Sans Arabic, self-hosted from `@fontsource`, then `system-ui`. No display face, no monospace, no Inter.

**Weights:** regular (400) and medium (500) for all text. Semibold (600) is permitted for **headline figures only** (a balance, a session count, a price at display size), and only once the 600 files are bundled.

### Scale (1.25 ratio, 16px base)
- **Display** 40/44, -0.02em, 500: the focal figure or name of a screen. The client's name in the record header; headline figures (session 12 of 25, balance owed, today's visit count). At most one display element per screen region.
- **H1** 31/38, -0.015em: the page heading.
- **H2** 25/32: a section heading, a drawer's title.
- **H3** 20/28: a panel or block heading.
- **Body** 16/26: running text, cells, values, buttons (at 500).
- **Small** 14/22: labels, table headers (at 500), counts, secondary lines, the Arabic name beneath a Latin one.
- **Micro** 13/18, 500, second ink: metadata, group labels in the rail. Sentence case.
- **Numeric:** `font-variant-numeric: tabular-nums lining-nums` on every numeral that could sit in a column, at every size, including display.

On the dark ground every step moves up one (h1 40/44, h2 31/38, h3 25/32, body 17/27, small 16/24, micro 14/20).

### Named rules
**The Focal Figure Rule.** If a screen's answer is a number or a name, it is set at display size, in tabular figures, with its label in small second ink above it. A screen with no display element must justify why nothing on it matters most.

**The Weight-Not-Hue Rule.** Emphasis is size, weight and space. A heading never has a coloured, italic or bold single word.

**The Kind-by-Weight Rule.** In the record timeline an event's kind shows in weight and tone alone: a change or creation is medium in ink, a read or system row regular in second ink.

## Layout

The console is a two-column grid: the rail on the inline start and a content column beside it, at least the viewport tall, capped at 1600px. Everything is written in logical properties so Arabic is a mirror, not a fork; `index.html` carries `lang` and `dir`.

### Page anatomy
1. **Header:** the h1 with its count in small second ink on the same baseline (16px apart), and the page's one primary action at the inline end. 24px beneath.
2. **Toolbar:** a wrapping row of fields, 16px gaps, aligned to the bottom edge. The search field takes the width.
3. **Panel:** the working content (a table, a form, an overview) on a white surface panel, `--r-3` radius, hairline edge in Rule, `--s-6` padding for forms and overviews, flush for tables.

### The record workspace
The client record and enrolment are full pages inside the shell: "Back to clients", then the **record header** (the client's name at display size, the Arabic name beneath, the record number in numeric small, the status chip, the programme stage, and the record's primary action at the inline end), then a 192px sticky section column beside a white content panel. Sections are vertical tabs with a brand-wash selected state and arrow, Home and End keys. At a container width of 767px or less the sections become a labelled select.

**The overview leads with the answer.** A record's first section shows, in this order: next visit (date, arrival window, readiness), programme (session x of N with the ribbon), household balance, latest report. Demographic facts sit in a Details block beneath. A destructive action never appears on the overview.

### Tiers
Compact first, two boundaries: 768px (tablet) and 1200px (desk), from `app/shell/shell.css` and `docs/SPEC/responsive-console.md`. Page padding is 16, 24 and 32px. The rail is open on the desk tier and a 64px strip of icons below it; the person's own choice wins and is remembered under `mcwellness.rail`. Wide tables scroll inside their panel with the first column pinned. The page body never scrolls sideways. The practitioner app, the portal and sign-in are designed for a phone's own width; nothing writes `user-scalable` or `maximum-scale`.

### Spacing
A 4px step: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Twelve is the horizontal unit inside rows and inputs; sixteen the gap between siblings; twenty-four between blocks and inside panels; thirty-two the desk page padding.

### Named rules
**The 44 Rule.** Rows, inputs, buttons and rail items are 44px tall. Drawer close, sign-out and every control on the instrument take 48px; the instrument's primary action takes 56px in the thumb zone.

**The Panel Rule.** Working content sits on a white panel; the paper ground is only the space between panels and the chrome around them. A panel is a container for one job, not a decoration: never a panel inside a panel, never a row of identical panels standing in for a table.

**The Logical Properties Rule.** No `left`, `right`, `margin-left` or `text-align: left`.

## Elevation and depth

Three levels, each meaning one thing.
- **Level 0, on the page.** Panels, rows, headings, fields. Panels separate from paper by tone and a hairline edge, not by shadow.
- **Level 1, raised** (`--lift-1`). The page's one primary action, and the danger button where one is shown. Pressed, it settles: the shadow goes.
- **Level 2, floating** (`--lift-2`). Something over the page: the drawer, the covering rail, a menu, the quick-find dialog. Always with a hairline edge.

The focus ring is `0 0 0 2px paper, 0 0 0 4px brand` on any `:focus-visible` element, on both grounds.

**The Three Levels Rule.** No fourth level, no shadow on hover, no shadow that is not one of the two tokens.

## Shapes

- `--r-2` (6px) is the default corner: buttons, inputs, rail items, tabs, chips that need a shape.
- `--r-3` (10px) is for panels and anything floating (drawer edge excepted, which is square against the viewport).
- `--r-1` (2px) is for small marks inside figures.
- The status dot is the only circle. A lead is a hollow ring.
- Icons: a 20px grid, 1.5px stroke, round caps and joins, `currentColor`, always `aria-hidden` (`app/shell/components/Icons.tsx`).
- The link is text with a hairline underline offset 0.18em that thickens to 2px on hover; no arrow, no box.

## Motion

Motion answers what the person just did, and stops. Three durations, one curve (`--ease`, `cubic-bezier(0.2, 0, 0, 1)`), all of them zero under `prefers-reduced-motion`:
- **Control, 120ms** (`--motion-control`): colour, background and border on hover and press for buttons, rail items, tabs, rows and links. Never size or position.
- **Surface, 160ms** (`--motion`): the drawer and the covering rail sliding in from their own edge, with `:dir(rtl)` mirrored. No exit animation.
- **Ribbon, 400ms** (`--motion-ribbon`): the newest slice growing into place once, the moment a session is completed or the client next opens their home screen.

Never: page-load choreography, staggered entrances, shimmer, bounce, parallax, animated numbers, or motion on the practitioner's screen while a session is running.

## States

**Loading holds the shape.** While data loads, the panel shows the layout it is about to fill: static placeholder rows at 44px with a hairline beneath and a block of paper tone where text will be. No shimmer, no spinner. The region carries `aria-busy="true"` and a visually hidden sentence ("Loading clients.") so assistive technology hears what sighted people see. A lazily loaded page renders its header and an empty panel immediately rather than nothing.

**Empty says what to do.** One sentence in second ink explaining why there is nothing, and the action that would change it when there is one.

**Errors sit with their cause.** A field's error takes its hint slot in critical ink with `aria-invalid` and `aria-describedby`; there is no red border. An outcome failing (a save, a load) is a critical Note with `role="alert"`, beside the thing that failed.

**High-stakes actions end on a confirmation.** Issuing an invoice, recording consent, recording erasure and completing a session finish on a confirmation state: what happened, in one sentence; the key figure at display size where there is one; the document to download or send; and what happens next. Not a Note line.

**Offline is a calm band,** never a red alert. Working offline is normal on the instrument.

## Components

### Buttons
One shell: 44px tall, 20px inline padding, `--r-2`, medium weight, inline-flex centred, 120ms colour ease.
- **Primary:** brand fill, white label, `--lift-1`. Hover brand lift; pressed brand deep with no shadow. One per screen region.
- **Secondary (default):** surface fill, ink label, 1px ink border. Hover 6% ink tint; pressed 10%.
- **Quiet:** no fill, no border; for tertiary actions and the rail's sign-out.
- **Danger:** critical fill, white label, `--lift-1`. Only where the destructive action is the point of the screen, never on an overview.
- **Disabled:** 50% opacity, default cursor.

### Fields
Label above in small second ink, 4px gap; a 44px surface box, 1px Rule border, `--r-2`, 12px padding. Selects draw a 20px chevron 12px from the inline end. Disabled fields drop to the paper ground and keep their hint. Search autofocuses at the tablet tier and above.

### Rail
The console's fixed inline-start column on the brand-deep ground: the mark and the wordmark at the top, sections in groups (Daily work, Finance, Practice) under micro labels, the person and the way out at the bottom above a hairline. Items are 44px with a 20px icon and a label; hover is brand lift; the active item is a white pill with brand text and medium weight. Closed, it is a 64px strip of icons with visually hidden labels. Every section the person may open appears in exactly one group (`app/shell/components/Rail.tsx`). A section's sub-pages are navigated on the page, by tabs, not repeated in the rail.

### Tabs
A page's sub-pages are an underline tab bar beneath the header: labels in body at 500, second ink at rest, ink when selected with a 2px brand underline, 120ms colour ease. Tabs are links (`aria-current="page"`) when they change the route.

### Ledger table (signature)
Homogeneous data in 44px rows on hairline rules, on a white panel.
- **Header:** sticky, surface ground, small medium in second ink, hairline beneath.
- **Rows:** hairline beneath; column rules where the owner has asked for them (2026-09-20); a 4% ink tint on hover, eased at 120ms; no zebra.
- **Alignment:** identifiers align start; quantities align end; all numerals tabular.
- **Name cell:** the Latin name as a link to the record, the Arabic name beneath in small second ink with `lang="ar" dir="rtl"`.
- **Programme cell:** where a list shows clients in a programme, a compact ribbon (the full strip at 24px tall) with "12 of 25" in small numeric beside it.
- **Loading:** placeholder rows (see States). **Empty:** a single spanning cell with a sentence.

### Session ribbon (signature)
`app/admin/reports/Ribbon.tsx`, fed by `domain/reports`. One strip for a whole programme: each delivered session a vertical slice (height its recording quality with a visible floor, colour its dominant band), sessions remaining as empty slices, a hairline at each brain map. It always carries a plain-language sentence beside or beneath it ("Session 12 of 25. Ten weeks in.") so the figure is never the only way to know. It appears on the client's home screen (at the top, full width), in the client record's overview, in the clients ledger (compact), at the end of a session (with the one ribbon animation) and on the report cover.

### Status chip
A word in ink after an 8px dot with an 8px gap: ok, attention, critical, neutral slate; a lead is a hollow ring. `ClientStatusChip` maps the client vocabulary onto it.

### Note
A sentence in second ink capped at 68ch, for empty states, outcomes and explanations. The critical tone carries `role="alert"`. Not a loading state.

### Drawer
Focused tasks open beside their context at the inline end: `clamp(320px, 55vw, 480px)`, resizable and remembered, surface ground, hairline inline-start edge, `--lift-2`, no scrim. Header and body pad 24px; the body scrolls. A 48px close control takes focus on open; Escape closes; focus returns. Enters over 160ms from its own edge; leaves instantly. Full width below 768px. The client record and enrolment are full pages, not drawers.

### Record timeline (signature)
History as sentences on hairline rules, newest first, grouped by day under sticky day headings. A change or creation is medium in ink; a read or system row regular in second ink; roles and a tabular time beneath in micro; a reason beneath that when given. "Show earlier" is a secondary button.

### Enrolment and consent
Enrolment is a full page with a sticky step guide, the current step on a surface fill with brand ink and `--lift-1`, and a sticky action row. Consent signing ("Select consents and sign once") keeps its behaviour, wording, gating and order exactly as built and reviewed (`docs/SPEC/enrolment-consent-ui.md`); visual refinement only.

## Do's and Don'ts

### Do
- **Do** give every screen one focal point and set it at display size when it is a number or a name.
- **Do** put working content on a white panel, and keep the paper ground for space and chrome.
- **Do** show a client's programme with the ribbon and a sentence, wherever the programme is the question.
- **Do** take every value from `app/shell/tokens.css`.
- **Do** ease control colour changes over 120ms, and zero all motion under reduced motion.
- **Do** hold the layout's shape while loading, with `aria-busy` and a hidden sentence.
- **Do** end issuing, signing, erasing and completing on a confirmation state.
- **Do** set status as a word with an 8px dot.
- **Do** use tabular lining figures on every numeral that could sit in a column.
- **Do** write layout in logical properties.
- **Do** keep the Latin wordmark "McWellness" in every locale.

### Don't
- **Don't** add a second accent, or use the brand inside a chart, or a band hue in chrome.
- **Don't** put homogeneous rows in cards or tiles; it is a table on a panel.
- **Don't** nest panels or line up identical panels as a substitute for a table.
- **Don't** put a destructive action on an overview, or make it the loudest object on any page where it is not the task.
- **Don't** animate entrances, stagger, shimmer, bounce, count up numbers, or move anything during a running session.
- **Don't** leave a region blank while it loads, or answer loading with only a sentence.
- **Don't** repeat a section's sub-pages in the rail; use the page's tabs.
- **Don't** set labels in all-caps, add an eyebrow above a heading, append an arrow to button text, or join metadata with middle dots.
- **Don't** colour, italicise or embolden a single word in a heading.
- **Don't** use a physical `left`/`right` property, a neutral black, or slate for text.
- **Don't** dim the page behind a drawer, or open a record's detail in a modal.
- **Don't** mark a timeline event's kind with an icon, badge, dot or coloured word.
