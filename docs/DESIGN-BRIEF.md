# McWellness — Visual Design Brief

*The source of truth for every UI decision. Claude Code reads this before writing any component.*

---

## 1. The brief

**Subject.** Neurofeedback training delivered in people's homes across Dubai. EEG sensors on a scalp, a practitioner in a family's living room, a 20–40 session program measured in brainwave frequency bands.

**Three audiences, three very different rooms:**

- A **parent** on their phone at 11pm wanting to know whether their nine-year-old is actually improving. Anxious. Not technical. Needs reassurance grounded in evidence, not a dashboard.
- A **practitioner** standing in a stranger's living room, phone in one hand, electrode paste on the other. Possibly dim light. Possibly a child climbing on them. Needs large targets, high contrast, zero ambiguity.
- A **lead practitioner and admin team** on desktop, dense data, many clients, long sessions. Needs information density without fatigue.

**The primary job:** make invisible change visible and trustworthy.

**What this is not:** a meditation app or a SaaS dashboard. McWellness is a wellness business, and two of its competitors position as "holistic centres"; its visual language should still read as *measurement* — closer to a good laboratory instrument than to a spa.

---

## 2. The governing idea

> **Colour is signal. The interface is silent.**

The interface chrome is achromatic — ink, paper, slate, rule. Colour appears only where it carries meaning from the data. When a colour shows up on screen, it means something specific, always the same thing, on every surface.

This is the decision that makes the whole system feel designed rather than decorated, and it is enforceable in code (Section 8).

---

## 3. Colour

### 3.1 The band spectrum — the only source of hue

The five EEG frequency bands, ordered slow to fast, mapped to a cool-to-warm temperature ramp. Slow waves are cool; fast waves are warm. Meaningful, immediately learnable, and it comes from the subject matter rather than from a palette generator.

| Band | Hz | Hex | Meaning in UI |
|---|---|---|---|
| Delta | 0.5–4 | `#3B4A87` | deep indigo |
| Theta | 4–8 | `#2C7387` | teal |
| Alpha | 8–12 | `#3D8557` | green |
| Beta | 12–30 | `#B8863A` | amber |
| Gamma | 30–100 | `#A8553F` | rust |

These five hexes appear in charts, protocol chips, session ribbons, report figures. **Nowhere else.** Never as a background wash, never as a button, never as decoration.

Each has a `-tint` (12% over paper) for chart fills and a `-deep` (20% darker) for text-on-light. That's it — no 50→900 ramps. Five bands, three values each.

### 3.2 Interface neutrals

```
--ink        #16242A   deep mineral, hue-bearing (not #111 — tinted near-black is a tell)
--ink-2      #3E5058   secondary text
--slate      #6B7C82   tertiary, metadata
--rule       #CBD5D6   borders, dividers
--paper      #EEF2F1   app background, cool mineral
--surface    #FFFFFF   cards, sheets, inputs
```

### 3.3 Status — the only non-band colour

Three, and they are deliberately desaturated so they never compete with band data:

```
--ok         #2F6B4F
--attention  #8A6A1E
--critical   #94382E
```

**One accent colour, and one only** (revised 2026-09-08, reversing "no accent colour"). The practice's own violet `#380473`, sampled from its mark, is the interface's accent: the rail's ground, the primary action, links, the active section and the focus ring. There is no brand blue and no second hue, and emphasis still comes chiefly from weight, size and space. The constraint that matters is now the separation: the accent never enters a chart's plotting area and no band hue is ever used for chrome, which is the fastest way to tell whether someone has actually followed the system. See `docs/SPEC/coloured-shell.md`.

### 3.4 Dark mode is functional, not optional

The practitioner app ships dark-first. Home visits happen in evenings, in dim living rooms, often with a child who has just had a session and doesn't need a phone flashlight in their face. Ink and paper invert; band hues shift up ~12% lightness to hold contrast on dark ground.

---

## 4. Typography

### 4.1 Arabic is a first-class requirement, not a translation layer

You are shipping bilingual EN/AR with real RTL. Almost every UAE health product does this badly — English typeface plus a fallback Arabic face that doesn't match in weight, x-height, or rhythm. Doing it properly is genuinely distinctive here and costs you nothing but the right font choice.

**Choose a family designed with Arabic from the start.**

- **Best:** Typotheque **Greta Sans** + **Greta Arabic**. Designed together, superb Arabic, wide weight range. Commercial licence, roughly USD 1,500–3,000 for web plus app. Worth it for a product whose main artefact is a printed report.
- **Budget:** **IBM Plex Sans** + **IBM Plex Sans Arabic**. Free, open licence, properly matched, genuinely good Arabic. Slightly familiar in developer contexts but reads as neutral-professional to your actual audience.

**Do not use Inter.** It is the single most common tell in generated interfaces.

### 4.2 One family, no display face

A second display typeface is the reflex move and it isn't earned here. There are no marketing headlines in this product — the largest type on screen is a client's name or a number. Use one family across the full weight range and let weight, size and tracking do the work.

The **marketing site** is the exception. It may take a distinct display face; the product must not.

### 4.3 Scale

Modular, 1.25 ratio, tuned per surface. Base 16px web, 17px mobile.

```
display  40 / 44   weight 500   tracking -0.02em   (rare: report covers only)
h1       31 / 38   weight 500   tracking -0.015em
h2       25 / 32   weight 500
h3       20 / 28   weight 500
body     16 / 26   weight 400
small    14 / 22   weight 400
micro    13 / 18   weight 500   (metadata, never all-caps)
```

**Practitioner app overrides:** every step up one size, minimum tap target 48px, minimum body 17px. Someone reading this at arm's length in bad light is not the same user as someone at a desk.

### 4.4 Numbers

Measurement data uses the family's **tabular lining figures**, not a monospace face. Monospace for small data labels is a generated-design tell, and tabular figures in a well-drawn sans align better and read cleaner in tables anyway. Enable `font-feature-settings: "tnum" 1` on every numeric cell.

### 4.5 Typographic prohibitions

Enforced in review:

- No ALL-CAPS labels or eyebrows.
- No accenting a single word in a heading with colour, italic, or bold.
- No em-dash-spaced label constructions (`WORD — fragment`).
- No middle-dot-joined metadata strings (`A · B · C`). Use spacing and rules.
- No `→` appended to button or link text. The button says what it does.
- Line length under 75 characters in body copy.

---

## 5. The signature element: the session ribbon

Spend the boldness in one place. This is that place.

A neurofeedback program is 20–40 sessions over 3–6 months, and the single hardest thing for a client is that progress is invisible until it isn't. The ribbon makes the whole program legible at a glance.

**What it is.** One continuous horizontal strip representing the entire program. Each session is a vertical slice. Slice height encodes session quality (signal cleanliness × time in target state); slice colour is the dominant trained band. Empty slices ahead show the sessions remaining. A hairline marks each re-map.

```
 ▁▂▃ ▃▄▃▅▄▆▅▇▆▇ ░░░░░░░░░
 └ baseline    └ re-map    └ remaining
 sessions 1–14 of 30
```

**Where it appears:**
- Client app — the home screen. It *is* the home screen.
- Admin console — one ribbon per client row, so the lead practitioner scans 40 clients' trajectories in one screen.
- PDF report — the cover figure.

One idea, three surfaces, instantly recognisable as yours. Everything around it stays quiet.

---

## 6. Layout, per surface

### 6.1 Practitioner app — "the instrument"

Dark ground. Single column, no nesting, one decision per screen. The session runner is full-bleed: signal quality as a single large indicator, elapsed time, and one primary action. No navigation chrome during a session.

```
┌──────────────────────────┐
│  Client L.        14:32   │
│  Session 12 of 30        │
├──────────────────────────┤
│                          │
│    signal                │
│    ●●●●○   good          │  ← large, glanceable
│                          │
│    18:24 elapsed         │
│                          │
├──────────────────────────┤
│      End session         │  ← 56px, thumb zone
└──────────────────────────┘
```

Offline state is a persistent, calm band — not a red alert. Working offline is normal, not an error.

### 6.2 Admin console — "the ledger"

Light ground, high density, **tables not cards.** Cards are for heterogeneous content; your admin data is homogeneous rows and belongs in a table. Chopping it into identical rounded cards with the same soft grey shadow is the SaaS-kit default and it actively reduces scannability.

Structure: a left rail (icon + label) that opens and closes, content area with sticky table headers, right-side detail drawer rather than modal dialogs. Row height 44px. Zebra striping off; use hairline rules at `--rule`.

*Changed 7 September 2026 on the operator's instruction. This line read "no collapse toggle". A console opened on a tablet needs the width back, and the rail's 220px is a quarter of an iPad in portrait; closed, it is a 64px strip of icons and every section is still one tap away. The person's choice is remembered on their device, and the rail's sections scroll inside it so a long list never pushes the person's name and the way out off a short screen. The three sizes the console now understands are in `docs/SPEC/responsive-console.md`.*

The dispatch map is the one full-bleed screen — map fills the viewport, practitioner list overlays left, no chrome competing with it.

### 6.3 Client app and portal — "the record"

Calm, generous, low density. Ribbon at top, then plain-language progress. Editorial rhythm, not dashboard rhythm.

**Copy tone matters as much as layout here.** "Your focus scores have improved steadily since session 8" — not "Beta/Theta ratio: +14.2%." The measurement is available on tap; the plain sentence is the default.

### 6.4 The report — the highest-stakes surface

This PDF goes to schools, coaches and whoever the family chooses. It circulates. It is your best marketing asset and it should be typeset like a scientific journal, not exported like a dashboard screenshot.

Single column, 68-character measure, generous margins, figures on a strict grid, the ribbon as cover, tabular figures throughout, page furniture minimal. Arabic edition is a genuine RTL layout — mirrored grid, Arabic numerals where appropriate, correct heading hierarchy — not a flipped English template.

---

## 7. Motion

Almost none.

Motion answers an action: a drawer opening, a session confirming, a value changing. 160ms, ease-out, and it shows what changed.

**Forbidden:** fade-and-slide-up entrances on sections, hover transitions on every row or card, skeleton shimmer, page-load orchestration. These are the generated-design default and they read as such immediately.

One exception: when a session completes and a new slice is added to the ribbon, that slice animates in once, 400ms. That is the emotional moment of the entire product. Give it the only real animation in the system and it will land.

`prefers-reduced-motion` respected everywhere, including that one.

---

## 8. Making Claude Code obey this

The brief only works if it is enforced mechanically. Four layers:

Repository note (2026-09-01): this repository is a single package (ADR 0001), so the paths below map as follows. `packages/ui/tokens.ts` is `app/shell/tokens.css`; `apps/**` and `packages/ui/components/**` are `app/**`; the CLAUDE.md block reads `app/shell/tokens.css`.

**1. Tokens as the only source of values.** `packages/ui/tokens.ts` exports every hex, size, spacing step and radius. No component may contain a literal colour or px value.

**2. A lint rule that fails the build** on any hex literal in `apps/**` or `packages/ui/components/**`. This is a ten-line ESLint rule and it is the single most effective thing you can do.

**3. A PostToolUse hook** that greps every written file for the specific tells: `#F4F1EA`, `#D97757`, `#111`, `#0B0B0B`, `text-transform: uppercase` on a label class, `font-family` containing `Inter` or `mono` outside the code-display component, `·` in a template string, `→` inside a button. Fails loudly.

**4. `design-critique` on every UI diff.** Run it as a subagent with this brief loaded. Ask specifically: *does anything here look like the default you'd produce for any similar product?* That question surfaces more than "review this design" does.

**Add to CLAUDE.md:**

```markdown
## Visual system
Read docs/DESIGN-BRIEF.md before writing any UI.
- Colour comes only from packages/ui/tokens. No hex literals in components.
- Hue inside a figure is reserved for EEG band data and three status states. The practice's violet is the chrome's one accent (2026-09-08), and the two never meet.
- One typeface family. Tabular figures for all numerals. Never monospace for data.
- No ALL-CAPS labels, no `→` in buttons, no `·`-joined metadata, no single-word
  colour accents in headings.
- Tables for homogeneous data. Cards only for heterogeneous content.
- Motion only in response to a user action, 160ms. One exception: the ribbon slice.
```

---

## 9. Prompting the first screen

Do not ask for "a nice dashboard." Give it the brief and a specific room:

```
Read docs/DESIGN-BRIEF.md and .claude/skills/frontend-design.

Build the practitioner session runner screen (apps/practitioner).
Context: a practitioner is standing in a client's living room, dim evening
light, phone in one hand, running session 12 of 30 for a 9-year-old.
They need to see signal quality and elapsed time at arm's length, and
end the session with one thumb.

Dark ground. Use only tokens from packages/ui/tokens.
Before coding: describe your layout in one paragraph and an ASCII
wireframe, and tell me which parts of your approach are the default
you'd produce for any session-timer screen. Revise those parts first.
```

That last instruction is the one that does the work. Asking it to identify its own defaults before building catches most of the genericism before it reaches the screen.

---

## 10. What to decide before anything gets built

1. **Font licence.** Greta Sans + Greta Arabic, or IBM Plex. This blocks everything else and needs a real decision, including budget for the report's print use.
2. **Band colour ramp.** Show the five hexes to your lead practitioner. If your team already associates specific colours with bands from your EEG hardware's software, match theirs — muscle memory beats aesthetic preference.
3. **Does the ribbon actually work?** Sketch it with real data from ten of your sessions before committing. If session quality doesn't vary enough to make an interesting shape, the idea fails and needs replacing.
4. **Arabic scope for v1.** Full bilingual product, or English product with Arabic reports? The second is much cheaper and covers the highest-value case. Decided 7 September 2026: the staff screens (the console and the practitioner app) are English only; every client-facing surface — the portal, invoices and receipts, reports, consent wording, the erasure letter and the messages the practice sends — stays bilingual.
