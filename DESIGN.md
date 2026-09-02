---
name: McWellness
description: An achromatic, hairline-ruled ledger in IBM Plex Sans; hue is reserved for band data and status, and there is no accent.
colors:
  ink: "#16242a"
  ink-2: "#3e5058"
  slate: "#6b7c82"
  rule: "#cbd5d6"
  paper: "#eef2f1"
  surface: "#ffffff"
  surface-hover: "#f1f2f2"
  surface-pressed: "#e8e9ea"
  selection: "#cbd1d1"
  ok: "#2f6b4f"
  attention: "#8a6a1e"
  critical: "#94382e"
  delta: "#3b4a87"
  theta: "#2c7387"
  alpha: "#3d8557"
  beta: "#b8863a"
  gamma: "#a8553f"
  ink-dark: "#eef2f1"
  ink-2-dark: "#c6d1d4"
  slate-dark: "#8fa0a6"
  rule-dark: "#2b3b41"
  paper-dark: "#10191d"
  surface-dark: "#16242a"
  ok-dark: "#5f9f83"
  attention-dark: "#c0a04e"
  critical-dark: "#c9705f"
typography:
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
  r-2: "4px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-8: "32px"
  s-12: "48px"
  s-16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.ink}"
  button-secondary-active:
    backgroundColor: "{colors.surface-pressed}"
    textColor: "{colors.ink}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 20px"
    height: "44px"
  link:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 12px"
    height: "44px"
  field-label:
    textColor: "{colors.ink-2}"
    typography: "{typography.small}"
  rail:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "24px 16px"
    width: "220px"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 12px"
    height: "44px"
  rail-item-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  rail-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  rail-item-later:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
  table-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.small}"
    padding: "0 12px"
    height: "44px"
  table-cell:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0 12px"
    height: "44px"
  status-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  note:
    textColor: "{colors.ink-2}"
    width: "68ch"
  note-critical:
    textColor: "{colors.critical}"
  drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    width: "480px"
  drawer-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.h2}"
    padding: "24px"
  drawer-body:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "24px"
  drawer-close:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-2}"
    size: "48px"
  drawer-close-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  drawer-section:
    textColor: "{colors.ink}"
    typography: "{typography.h3}"
  timeline-day:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.small}"
    padding: "8px 0"
  timeline-event:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "12px 0"
  timeline-event-read:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
  timeline-meta:
    textColor: "{colors.ink-2}"
    typography: "{typography.micro}"
  timeline-reason:
    textColor: "{colors.ink-2}"
    typography: "{typography.small}"
---

# Design System: McWellness

## Overview

**Creative North Star: "The Silent Ledger"**

McWellness is a wellness practice whose product must read as measurement, closer to a good laboratory instrument than to a spa, and its console is a ledger, not a dashboard. Rows, hairline rules and figures carry the practice. The category default of cards, hero metrics and an accent button is refused: a client is a row, a count is a number beside the heading, and the primary action on the first viewport is a search field. The coordinator sees the practice's people at a glance and finds one in seconds.

The chrome is silent. Every interface surface is achromatic: hue-bearing mineral ink on cool mineral paper, structure drawn in hairline rules, one typeface family (IBM Plex Sans with its matched Arabic) at two weights, tabular figures wherever a numeral appears. Colour is signal: it is reserved for the five EEG bands and the three status states, and it appears only where it carries meaning from the data. There is no accent colour. Emphasis comes from weight, size and space. The inherited McWellness violet lives in the logo image and nowhere in the interface (owner's decision, 2026-09-02).

The system has three grounds that share one token set. The ledger (light, dense, the admin console) is the reference surface and the only one fully built. The instrument (dark, `[data-ground='dark']`, the practitioner's phone) inverts ink and paper, lifts the band and status hues, and steps every type size up one so it reads at arm's length in a dim room. The record (light, calm, the client portal) uses the same tokens at a 68-character measure and low density. Sampled at the finish review on 2026-09-02: paper #EEF2F1, ink #16242A, hairline #CBD5D6 rules, 44px rows, tabular figures, status in words with a 6px dot, and an ink-on-paper primary button; no hue, no cards, no accent. Sampled again after PR 6: a record's detail opens in a 480px drawer at the inline end, surface white on a hairline edge with the one soft shadow and no scrim, and its history is a list of sentences on 12px-stepped hairline rules; the ledger stays readable beside it.

**Key Characteristics:**
- Achromatic chrome: mineral ink on cool paper, structure in hairline rules, no accent colour anywhere.
- Hue is signal: five band colours reserved for band data, three desaturated status colours carried by a 6px dot beside a word.
- One family, two weights: IBM Plex Sans and IBM Plex Sans Arabic at 400 and 500, self-hosted; tabular lining figures on every numeral.
- Tables, not cards: homogeneous data sits in 44px rows on hairline rules, with sticky headers and no zebra striping.
- Detail beside the ledger: a record opens in a drawer at the inline end, over the list without a scrim, never in a modal dialog.
- Three grounds, one token set: the ledger (light), the instrument (dark, type up one step) and the record (light, 68ch measure).
- Logical properties only, so every layout mirrors for Arabic.
- Almost no motion: feedback is instant, and the drawer's 160ms entrance is the one transition in the shell.

## Colors

The palette is a hue-bearing near-black on cool mineral paper, with hue permitted only where it means something.

### Neutral
- **Mineral Ink** (#16242a): primary text, the primary button's fill, the focus ring's outer band, the link and its underline, and the surface colour on the dark ground. Tinted, never #111; a neutral black is a tell.
- **Second Ink** (#3e5058): secondary text (field labels, table headers, the count beside a heading, notes), placeholder text, the chevron on a select, sections that have not yet arrived in the rail, the drawer's close control at rest, and in the timeline the day headings, a read or system sentence, the roles-and-time line and the reason line. Also the primary button's hover fill. The lowest tone allowed for running text.
- **Slate** (#6b7c82): marks and rules only: the default status dot, the icon on a not-yet-arrived rail section. Never body or label text; it sits below the contrast floor for small type.
- **Rule** (#cbd5d6): every hairline: table rules, the rail's edge, field borders, the line under the sign-in mark, the scrollbar thumb, the drawer's inline-start edge and the rule under its header, and the rule beneath each timeline event.
- **Cool Mineral Paper** (#eef2f1): the app ground, the rail, sticky table headers, the primary button's text, and the close control's hover fill.
- **Surface** (#ffffff): inputs, secondary buttons, the active rail item, the hover state of rail items, and the drawer (including the sticky day headings inside it, so events pass under them).
- **Surface, hovered** (#f1f2f2) and **Surface, pressed** (#e8e9ea): instant feedback on secondary buttons and rail items. In code these are `color-mix` of ink at 6% and 10% over surface, so they follow the ground.
- **Selection** (#cbd1d1): text selection; ink at 16% over paper in code.

### Status
The only non-band hue, deliberately desaturated so it never competes with band data. It is carried by a 6px dot beside a word, never by the word.
- **Ok** (#2f6b4f): the dot on an active client.
- **Attention** (#8a6a1e): the dot on a paused client.
- **Critical** (#94382e): the dot on an erased client, and the colour of a critical note (an error line).

### Band spectrum (reserved)
The five EEG bands, slow to fast, cool to warm: **Delta** (#3b4a87, deep indigo), **Theta** (#2c7387, teal), **Alpha** (#3d8557, green), **Beta** (#b8863a, amber), **Gamma** (#a8553f, rust). Each has a `-tint` (12% over paper, for chart fills) and a `-deep` (80% toward black, for text on light) derived in `app/shell/tokens.css`; on the dark ground the base lifts to 84% base plus 16% white. The tokens exist for charts, protocol chips, the session ribbon and report figures. No shipped screen uses them yet. They are recorded here as reserved, not as used.

### The dark ground
`[data-ground='dark']` redefines the same custom properties rather than adding a theme: ink becomes #eef2f1, second ink #c6d1d4, slate #8fa0a6, rule #2b3b41, paper #10191d, surface #16242a; ok #5f9f83, attention #c0a04e, critical #c9705f. Components never reference a `-dark` token by name; they reference `--ink` and `--paper` and let the ground decide.

### Named Rules
**The Silent Chrome Rule.** Interface chrome is achromatic. Hue comes only from band data and the three status states. There is no accent colour, no brand blue, no primary violet; emphasis is weight, size and space. The fastest test of a new screen is whether any colour on it is not a band or a status.

**The Status-in-Words Rule.** Status is written as a word in ink; a 6px dot beside it carries the hue (ok, attention, critical). The default dot is slate, a lead is a hollow ring in second ink, and the word is never coloured.

**The Band Reservation Rule.** The five band hexes appear in charts, protocol chips, session ribbons and report figures. Nowhere else: never a background wash, never a button, never decoration.

**The Ground Swap Rule.** Dark is a ground, not a preference toggle. It is set by `data-ground='dark'` on the surface that needs it (the practitioner's instrument), and it swaps every token at once: ink and paper invert, bands and status lift, type steps up one.

## Typography

**Display Font:** none. One family across every size.
**Body Font:** IBM Plex Sans (with IBM Plex Sans Arabic, then system-ui, sans-serif)
**Label/Mono Font:** none. Labels are the same family; numerals are the family's tabular lining figures, never monospace.

**Character:** A family designed with Arabic from the start, so the two scripts match in weight, x-height and rhythm. Two weights only, regular (400) and medium (500), loaded from `@fontsource` and served from the app itself. The largest type on any screen is a client's name or a number; there are no marketing headlines in the product, and the scale is tuned for reading, not for display.

### Hierarchy
The scale is modular at a 1.25 ratio from a 16px base. On the dark ground every step moves up one (h1 40/44, h2 31/38, h3 25/32, body 17/27, small 16/24, micro 14/20) so the practitioner reads at arm's length.
- **H1** (500, 31px/38px, -0.015em): the page heading (Clients, Sign in, Today, Your record); balanced wrapping.
- **H2** (500, 25px/32px): section headings within a page, and the drawer's title (the client's name); balanced wrapping.
- **H3** (500, 20px/28px): the wordmark in the rail, sub-section headings, and the drawer's section heading ("Timeline").
- **Body** (400, 16px/26px): running text, table cells, field values, buttons (at 500), the link, and timeline sentences (a change or a creation at 500). Notes are capped at a 68ch measure.
- **Small** (400, 14px/22px): field labels, table headers (at 500), the count beside a heading, the Arabic name beneath a Latin one, the drawer's record number and status line, the timeline's day headings (at 500), the reason line under an event, secondary lines.
- **Micro** (500, 13px/18px, second ink): metadata such as a person's roles, the "Arriving" mark on a rail section, or the roles and tabular time beneath a timeline sentence. Sentence case, never all-caps.
- **Numeric** (tabular lining figures): applied as a class to every cell or span that holds a record number, an age, a count, a phone number or a time.
A 40px/44px display step (-0.02em) exists in the tokens for report covers only; nothing in the shipped app renders it.

### Named Rules
**The One Family Rule.** IBM Plex Sans and IBM Plex Sans Arabic, at 400 and 500, are the only faces. No display face, no monospace, no Inter.

**The Tabular Figures Rule.** Every numeral that could sit in a column takes `font-variant-numeric: tabular-nums lining-nums`. Record numbers, ages, counts, phone numbers and times align because of the figures, not because of a monospace fallback.

**The Weight-Not-Hue Rule.** The only tools of emphasis are the medium weight, the next size up, and space around the thing. A heading never has a single coloured, italic or bold word.

**The Kind-by-Weight Rule.** In a list of events, what kind of event a row is shows in its weight and tone alone: a change or a creation is medium in ink, a read or a system row is regular in second ink. No icon, no badge, no dot and no coloured word marks the kind.

## Layout

The ledger is a two-column grid: a 220px rail on the inline start and a content column beside it (`grid-template-columns: 220px minmax(0, 1fr)`), the whole at least the viewport height. The rail is sticky and full height, padded 24px vertically and 16px horizontally, with a hairline on its inline-end edge. The content column pads 32px on top and sides and 64px below, and its content is capped at 1200px. Everything is written in logical properties (inline-start, block-end, padding-inline) so the layout mirrors for Arabic without a second stylesheet; `index.html` carries `lang` and `dir`.

Page furniture is fixed: the heading and its count sit on one baseline with a 16px gap and 24px beneath; the toolbar is a wrapping row with 16px gaps aligned to the bottom edge, 24px beneath; then the table. The search field is the primary action and takes the width (`flex: 1 1 24rem`, capped at the 68ch measure) while the status select sits beside it at a minimum of 12rem. Both fields sit on a 4px gap under their label.

The drawer is the ledger's second width token beside the rail: 480px (`--drawer`), fixed to the block edges and the inline end, above the content (`z-index: 2`) with no scrim and no shift of the list beneath, never wider than the viewport. Its header and body each pad 24px; the header closes with a hairline, and the body scrolls on its own so the title stays put. Inside it the timeline keeps the ledger's rhythm at a finer step: a day heading with 16px above and 8px of block padding, events padded 12px block on hairline rules, 4px between a sentence and its meta line and again before a reason, and 24px of block padding around the paging button.

The spacing scale is a 4px step: 4, 8, 12, 16, 20, 24, 32, 48, 64. Twelve is the horizontal unit inside rows, rail items and inputs, and the block unit of a timeline event; sixteen is the gap between siblings; twenty-four is the gap between blocks and the drawer's padding; thirty-two is the page's outer padding.

Density is set by one number: every row, input, button and rail item is 44px tall. The tap target rises to 48px for the sign-out control, the drawer's close control and, by the brief, on the instrument. Sign-in and the plain landing pages are a single centred column, 24rem wide (28rem on the instrument, the 68ch measure on the record), padded 64px above and 24px at the sides.

There is one breakpoint, at 720px. Below it the grid collapses to one column; the rail becomes a static band under a hairline, laid out as a two-row grid with the wordmark and the person on the first line and the sections wrapping on the second; not-yet-arrived sections and the roles line are hidden; the page pads 24px above, 16px at the sides and 48px below; the toolbar fields go full width; the drawer takes the full width and drops its edge hairline; and the table scrolls inside its own container with the first two columns (the record, 7.5rem wide, and the name) pinned on the inline start, the name column drawing an inset hairline on its end edge. The page body never scrolls sideways.

### Named Rules
**The 44 Rule.** Rows, inputs, buttons and rail items are 44px tall. One height sets the ledger's rhythm; the sign-out control, the drawer's close control and the instrument's controls take 48px.

**The Logical Properties Rule.** No `left`, `right`, `margin-left` or `text-align: left` anywhere. Inline-start and inline-end, so Arabic is a mirror and not a fork.

**The Hairline Rule.** Structure is drawn with 1px rules in Rule (#cbd5d6): table rows, the rail's edge, field borders, the drawer's edge, the rule under each event. No zebra striping, no card borders, no boxes around groups.

**The Beside Rule.** A record's detail opens in the drawer at the inline end, 480px wide, over the ledger with no scrim, so the list stays readable beside it; below 720px the drawer takes the full width. Detail is never a modal dialog.

## Elevation & Depth

The system is flat at rest. No surface on the ledger carries a shadow, at rest or on interaction; depth is conveyed by tone (surface white on paper for inputs, buttons and the active rail item), by hairline rules, and by the sticky positioning of the rail, the table header and the timeline's day headings. One surface is lifted: the drawer, which sits over the ledger and takes the single soft offset shadow (`0 8px 24px` of ink at 14%, black at 40% on the dark ground) together with a hairline at its inline-start edge, so its edge is drawn as well as cast. The shadow token exists for surfaces that sit over the ledger (the drawer today; menus when they arrive) and for nothing on the ledger itself.

The focus ring is the one treatment that lifts a control: a 2px band of paper inside a 2px band of ink (`0 0 0 2px paper, 0 0 0 4px ink`), on a 4px radius, applied to any `:focus-visible` element. It reads on both grounds because both bands swap with the ground.

### Shadow Vocabulary
- **Drawer lift** (`box-shadow: 0 8px 24px color-mix(in srgb, var(--ink) 14%, transparent)`; `0 8px 24px` black at 40% on the dark ground): the drawer, always paired with a hairline edge. Menus, when built, take the same.
- **Focus ring** (`box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink)`): every `:focus-visible` element.

### Named Rules
**The Flat Ledger Rule.** Surfaces are flat. Depth is tone and rule, never a drop shadow, with one exception: a surface that sits over the ledger (the drawer; menus when they arrive) takes the one soft offset shadow and a hairline at its edge. Nothing on the ledger itself carries a shadow, and nothing gains one on hover.

## Shapes

Rectilinear with a single softening. Every rounded corner in the app is 4px: inputs, buttons, rail items, the seeded-person buttons on sign-in, the drawer's close control, and the focus ring. The 2px and 8px steps exist in the token file and are unused. The only circle is the 6px status dot (filled in a status hue or slate; hollow, as a hairline ring in second ink, for a lead). Icons are drawn on a 20px grid with a 1.5px stroke, round caps and joins, in `currentColor`, and are always marked `aria-hidden`; the close icon is two such strokes crossing. Borders are hairlines (1px) in Rule, except the secondary button, whose hairline is in ink. The link is bare text with a hairline underline offset 0.18em that thickens to 2px on hover; no box, no arrow. The drawer is a rectangle with square corners, bounded by a hairline on its inline-start edge. Nothing is clipped, tilted or masked.

## Components

### Buttons
Ink on paper, hairline-bordered, instant to respond. Three variants share one shell.
- **Shape:** softly squared (4px radius), 44px tall, 20px horizontal padding, medium weight, inline-flex centred.
- **Primary:** ink fill (#16242a), paper text (#eef2f1). One per screen; it is the sign-in submit. Hover shifts the fill to second ink (#3e5058).
- **Secondary (default):** surface fill (#ffffff), ink text, a 1px ink border. Hover tints the fill with 6% ink (#f1f2f2); press tints it with 10% (#e8e9ea). The timeline's "Show earlier" paging control is this variant.
- **Quiet:** transparent fill and border, ink text; the rail's sign-out control is this variant with a 20px icon and an 8px gap, 48px tall.
- **Disabled:** 50% opacity, default cursor.
- **Focus:** the shared ring. No transition on any state.

### Link
An in-page control that reads as a link: in the ledger, the client's name opens the drawer.
- **Style:** a `button.link` reset to its text: no padding, border or fill; inherits the cell's font; ink; aligned start; a hairline underline offset 0.18em.
- **Hover:** the underline thickens to 2px. Nothing else changes and nothing transitions.
- **Focus:** the shared ring. No arrow, no colour, no icon.

### Inputs / Fields
A label above, a box below, both in the ledger's vocabulary.
- **Style:** the label is small (14px) in second ink with a 4px gap; the input is 44px tall, surface fill, a 1px Rule border, 4px radius, 12px horizontal padding, ink text, placeholder in second ink. Browser chrome is removed (`appearance: none`, search decorations hidden).
- **Select:** the same box, with a 20px chevron in second ink absolutely placed 12px from the inline end and 40px of end padding so the value never runs under it.
- **Search:** the primary action on the clients page; it takes the toolbar's width and autofocuses at 720px and above.
- **Focus:** the shared ring. **Error:** there is no red border; errors are a critical Note beneath the form.

### Navigation
The rail: the console's fixed inline-start column, icon and label, no collapse toggle.
- **Style:** 220px wide, paper ground, hairline inline-end edge, sticky and full height. The wordmark "McWellness" sits at the top in h3 medium with 32px beneath; the person block (name in medium, roles in micro, sign-out) is pushed to the bottom above a hairline.
- **Items:** 44px tall, 12px horizontal padding, 12px gap between a 20px icon and the label, 4px radius, ink text; 4px between items.
- **Hover:** surface fill, instant. **Active:** surface fill and medium weight.
- **Arriving:** a section that has not shipped is listed as text in second ink with its icon in slate and the word "Arriving" in micro on the end, `aria-disabled`; never a dead link.
- **Mobile:** below 720px the rail becomes a band under a hairline: wordmark and person on one line, the live sections wrapping beneath, arriving sections hidden.

### Status Chip
- **Style:** a word in ink, preceded by a 6px dot with an 8px gap; no background, no border, no pill.
- **State:** active takes the ok dot, paused the attention dot, erased the critical dot, closed the default slate dot; lead is a hollow ring (transparent fill, 1px inset ring in second ink).

### Note
A quiet line of text that answers a state. Loading, empty and error states are a sentence, never a banner or a skeleton.
- **Style:** body text in second ink, capped at 68ch. The critical tone is the critical colour and carries `role="alert"`.

### Page Header
- **Style:** the h1 and, on the same baseline 16px to its end, the count in small second ink with tabular figures ("20 clients"), 24px beneath.

### The Ledger Table (signature)
The console's defining surface: homogeneous rows on hairline rules.
- **Container:** scrolls horizontally inside itself, opened by a hairline on its top edge.
- **Header:** sticky at the top, paper ground so rows pass under it, small (14px) medium in second ink, 44px tall, 12px horizontal padding, hairline beneath.
- **Rows:** 44px tall, 12px horizontal padding, a hairline beneath each, no zebra, no hover tint, cells vertically centred and unwrapped.
- **Alignment:** identifiers (the record number, phone numbers) align start even though they are numerals; quantities marked `align: end` align end. Numeric cells take tabular lining figures.
- **Name cell:** the Latin name as a Link that opens the drawer, and beneath it the Arabic name in small second ink with `lang="ar"` and `dir="rtl"`.
- **Contact cell:** relationship in ink, then the phone number in numeric second ink, on one baseline with a 12px gap.
- **Empty:** a single spanning cell, 24px vertical padding, wrapped text in second ink.
- **Mobile:** the first two columns pin to the inline start on paper ground; the second draws an inset hairline on its end edge.

### The Drawer (signature)
A record's detail opens beside the ledger, not over a dimmed page.
- **Placement:** fixed to the block edges and the inline end, 480px wide (`--drawer`), never wider than the viewport, above the content with no scrim; the ledger neither moves nor dims.
- **Surface:** white on a hairline at its inline-start edge, lifted by the one soft shadow (see Elevation).
- **Header:** 24px padding, a hairline beneath. The title block stacks the client's name (h2), the Arabic name beneath in small second ink (`lang="ar"`, `dir="rtl"`, pinned to the inline start as in the ledger's name cell), then the record number in numeric and the status chip, each on its own line at 4px gaps; nothing joins them with a dot or a bar.
- **Close:** a 48px square control at the header's end: transparent, the 20px close icon in second ink, 4px radius, pulled 8px into the padding on every side so the glyph sits on the title's grid. Hover: ink on paper, instant. It takes focus when the drawer opens; Escape closes; focus returns to the name that opened it.
- **Body:** 24px padding, scrolls inside itself; the section heading (h3 in ink), then the content.
- **Entrance:** the one motion in the shell. 160ms on the ease-out (`cubic-bezier(0.2, 0, 0, 1)`), sliding 24px in from its own edge and fading from 0 through `@starting-style`; `:dir(rtl)` mirrors the translate so the Arabic drawer enters from its own side; both properties drop to 0ms under `prefers-reduced-motion`. It leaves instantly; there is no exit animation.
- **Mobile:** below 720px it is the full width and drops its edge hairline.
- **Semantics:** an `aside` with `role="dialog"` labelled by its title. No backdrop, no focus trap.

### The Record Timeline (signature)
A client's history as sentences on rules: the ledger's vocabulary turned to time.
- **Structure:** newest first, grouped by day in the practice's time zone. Each day heading (an `h3` set at small, medium, second ink) is sticky at the top of the drawer body on the surface, so it holds while its events scroll under it, with 16px above and 8px of block padding.
- **Events:** an ordered list; each event pads 12px block and closes with a hairline. The sentence is body text: a change or a creation is medium in ink, a read or a system row is regular in second ink (The Kind-by-Weight Rule). No icon, no dot, no card, no colour.
- **Meta:** 4px beneath the sentence, a micro line in second ink: the actor's roles ("Owner, Admin, Lead practitioner, Finance") and the time in tabular figures, on a 12px gap. Roles show once per run of the same actor and roles, not on every line; the time shows on every line.
- **Reason:** 4px beneath the meta, when one was given: small second ink with a colon label ("Reason: synthetic seed").
- **Paging:** a secondary button, "Show earlier", inside 24px of block padding. Loading, empty and error states are Note lines.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, spacing step, radius and timing from `app/shell/tokens.css`; the lint rule `mcwellness/no-hex-colour` refuses a literal in app code.
- **Do** draw structure with 1px rules in Rule (#cbd5d6) at a 44px row height, with sticky headers and no zebra striping.
- **Do** set status as a word in ink with a 6px dot beside it; ok, attention and critical live in the dot.
- **Do** apply tabular lining figures to every numeral that could sit in a column.
- **Do** use only the regular (400) and medium (500) weights of IBM Plex Sans and IBM Plex Sans Arabic, self-hosted.
- **Do** write layout in logical properties so the Arabic layout is a mirror.
- **Do** give a screen at most one primary button, ink on paper, and prefer a search field as the first action on a list.
- **Do** answer loading, empty and error states with a Note line in second ink or critical, capped at 68ch.
- **Do** put the dark ground on a surface with `data-ground='dark'` and let the tokens swap; never restyle a component for dark.
- **Do** keep the Latin wordmark "McWellness" in every locale.
- **Do** open a record's detail in the drawer: 480px at the inline end on surface, a hairline edge and the one soft shadow, no scrim, full width below 720px.
- **Do** make an in-page control that reads as a link a `button.link` in ink with a hairline underline that thickens to 2px on hover.
- **Do** write history as sentences on hairline rules at a 12px block step: a change or creation in medium ink, a read or system row in regular second ink, roles and a tabular time in micro beneath.

### Don't:
- **Don't** add an accent colour. There is no brand blue or violet in the interface; the inherited violet lives in the logo image only.
- **Don't** use a band hue outside band data (charts, protocol chips, the session ribbon, report figures); never as a wash, a button or decoration.
- **Don't** put homogeneous data in cards, hero metrics or tiles; it is a table.
- **Don't** set labels, headers or micro text in all-caps, or add an eyebrow or kicker above a heading.
- **Don't** use a monospace face for numbers, a second display face, or Inter.
- **Don't** add hover transitions, skeleton shimmer or page-load orchestration; feedback is instant, and the drawer's 160ms entrance is the only transition in the shell.
- **Don't** append an arrow to button or link text, or join metadata with middle dots.
- **Don't** colour, italicise or embolden a single word inside a heading.
- **Don't** use a physical `left`/`right` property or a neutral black (#111).
- **Don't** colour a status word, add a pill behind it, or use slate for running text.
- **Don't** dim the ledger behind the drawer with a scrim, or open a record's detail in a modal dialog.
- **Don't** mark a timeline event's kind with an icon, a badge, a dot or a coloured word; weight and ink tone carry it.
