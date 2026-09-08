# SPEC — Neutrals that belong to the mark, and depth that means something (piece twenty-one)

*Worktree: `harmony`, branch `harmonised-neutrals`. Shared zone: `app/shell/tokens.css`
and `app/shell/shell.css`. No entity, no migration, no API route, no component
markup. Two decisions, taken by the operator on 8 September 2026.*

Status: **built 8 September 2026.** The operator, seeing the coloured console
live, said the light green ground did not go with the violet sidebar, asked for
the interface to be harmonised, for sizing that looks like it has a purpose,
and for "drop shadows with a purpose as well" — the whole to read futuristic
and clear, "something like Apple style", and not generic.

---

## 1. The fault, precisely

`--paper` was `#eef2f1`: a cool mineral green at **hue 165**. `--brand` is
`#380473` at **hue 268**. A hundred and three degrees apart.

That is the entire complaint, and it is worth being exact about whose fault it
was: **nobody's.** The greys were chosen on 2 September for an interface that
had no accent colour, and against ink and white they were a good, considered,
slightly cool neutral. They stopped being neutral on 8 September, the moment
the rail turned violet — because a neutral is only neutral relative to what it
sits beside. A colour a hundred degrees from the only hue on the screen is not
a grey; it is a second colour, and the eye reads the pair as an argument.

The other five neutrals were the same story at hues 185 to 198.

## 2. What changed

Every neutral is re-cast onto the mark's own hue, keeping its lightness so no
contrast relationship is disturbed, and the ground alone is darkened. Section 4
says why the ground had to move.

| Token | Was | Now | Hue was → is |
|---|---|---|---|
| `--ink` | `#16242a` | `#1f152b` | 198 → 266 |
| `--ink-2` | `#3e5058` | `#4a4056` | 198 → 266 |
| `--slate` | `#6b7c82` | `#756c81` | 196 → 266 |
| `--rule` | `#cbd5d6` | `#d0cbd6` | 185 → 266 |
| `--paper` | `#eef2f1` | `#e9e7ec` | 165 → 266, and 94.1% → 91.5% lightness |
| `--surface` | `#ffffff` | `#ffffff` | unchanged; white has no hue to argue with |

The practitioner's dark ground takes the same treatment, so the two grounds are
one family rather than two: `--paper` `#10191d` → `#150f1e`, `--surface`
`#16242a` → `#1f162a`, `--ink` `#eef2f1` → `#f0edf3`, `--ink-2` `#c6d1d4` →
`#ccc6d4`, `--slate` `#8fa0a6` → `#9990a5`, `--rule` `#2b3b41` → `#342a42`.

**Contrast is not merely preserved; most pairings improve.** Measured before
the values were written down:

| Pairing | Was | Now |
|---|---|---|
| Ink on paper | 14.10 | 14.25 |
| Second ink on paper | 7.46 | 7.92 |
| Brand on paper | 12.98 | 11.94 |
| Brand on the dark ground | 5.16 | 5.43 |
| White surface off the ground | 1.15 | **1.23** |

The last row is the one that matters, and section 4 is about it.

## 3. Nothing was chosen by eye

Four directions were rendered into the real console with the real stylesheets —
the incumbent, a violet-cast at today's lightness, a graphite at hue 250, and
the darker-ground "ice" — and the operator chose from the rendering, not from a
list of hex values. The two rejected directions are recorded here because a
choice with no alternatives is not a choice: the violet-cast kept the ground at
94.1% and so could not carry shadows, and the graphite at hue 250 removed the
argument with the violet without creating any kinship to it.

## 4. Why the ground had to drop, and why the old rule was right

`DESIGN.md` carried **The Flat Ledger Rule**: *"Surfaces are flat. Depth is tone
and rule, never a drop shadow."*

That rule was not a principle. It was a consequence of a number. At 94.1%
lightness the ground sat **1.15:1** from white — a shadow cast onto it had
almost nothing to darken, so depth genuinely could not be seen and hairlines
were the only honest way to draw it. Whoever wrote the rule was describing
their materials accurately.

Dropping the ground to 91.5% moves white to 1.23:1, and at that distance the
same shadows read. So the rule is replaced rather than broken: the ledger
itself stays flat, which was always the right half.

## 5. Depth: three levels, and only three

| Level | Token | What takes it |
|---|---|---|
| 0, on the ledger | none | Rows, tables, headings, fields — the page itself |
| 1, raised | `--lift-1` | The page's **one** primary action, and nothing else |
| 2, floating | `--lift-2` | The drawer, the covering rail, menus when they arrive |

**Level 1 is deliberately scarce.** Exactly one object on a page is ever
raised, so being raised carries information: it says *this is the thing to
press*. A second raised object would make both mean nothing. Pressing removes
the shadow, so what settles is the affordance itself.

**Each level is two shadows, not one:** a tight contact shadow saying the
surface rests on something, and a wider ambient one saying how far above. A
single blur reads as a sticker. Neither is a zero-offset halo, which is
decoration rather than depth.

## 6. Sizing with a purpose

Two changes, both about rhythm rather than size.

**Radius.** `--r-2` goes 4px → 6px and `--r-3` 8px → 10px. At the new ground's
contrast, 4px read as an unconsidered default; 6px is the smallest radius that
looks chosen.

**Separation, not spacing.** Groups stay tight; the distances *between* blocks
grow. A heading and the toolbar under it were 24px apart and read as one
undifferentiated stack. The page header and the toolbar now take `--s-8` (32px)
beneath them, and the desk tier's page padding takes a new `--s-10` (40px) on
the inline axis. Nothing inside a group moved, and the 44px row is untouched:
this is a ledger and its density is the point.

## 7. Guards

`tests/lint/neutrals-share-the-hue.test.ts`, added here:

1. **Every neutral sits within 30 degrees of the mark's hue**, on both grounds.
   Colours below 4% saturation are exempt, because a near-achromatic colour has
   no meaningful hue — white is not a violation.
2. **The ground stays dark enough for a surface to lift off it.** The elevation
   scale is only honest while this holds, so it is asserted rather than
   remembered.

Both were confirmed to fail on the old palette before being kept: restoring
`--paper: #eef2f1` produces `--paper #eef2f1 is 103deg from the mark`. A guard
that has never failed has not been tested.

The existing guards are unchanged and still pass: `brand-contrast`,
`colour-keeps-its-meaning`, `layout-tokens`, `one-set-of-breakpoints`,
`no-hex-colour`, `console-is-english`.

## 8. What this piece does not do

No markup changes, no component changes, no new surfaces, no motion. Every
screen in the app inherits this through the tokens it already reads, which is
what the token system was built for. The band spectrum and the three status
colours are untouched, and the separation rule of
`docs/SPEC/coloured-shell.md` section 11 still holds.
