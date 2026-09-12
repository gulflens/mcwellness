# Accessibility — where the practice stands

*Written 8 September 2026, when the console was given three screen sizes
(`docs/SPEC/responsive-console.md`). Until then nothing in this repository
recorded an accessibility position at all. This file is that record: what the
product does, where it deliberately falls short of a standard, and what a
person who cannot use it that way should do instead.*

---

## 1. The standard the practice measures against

WCAG 2.2 at level AA, as a target rather than a certification. Nobody has
audited these screens. What follows is what the build knows about itself.

## 2. Zoom is never taken away

No surface writes `user-scalable=no` or `maximum-scale`. A person may always
pinch, and the browser's own text sizing always applies. Two tests enforce it
rather than leaving it to care: `tests/lint/layout-tokens.test.ts` reads every
stylesheet and component under `app/` and refuses either word, and
`app/shell/viewport.test.ts` asserts it of every viewport value the console can
produce. This is the one accessibility rule the build treats as absolute.

## 3. The console on a phone: a deliberate trade, stated plainly

On a screen narrower than 768px the admin console declares a 1024px layout
width and the browser shows the whole page scaled to fit, for the person to
pinch and pan (`app/shell/viewport.ts`). The operator chose this on 7 September
2026 over a reflowed phone layout, so that a phone shows the same console a
laptop does, with no column hidden and no screen rearranged.

**What it costs.** On a 390px phone the initial scale is about 0.38. Against
the type scale in `app/shell/tokens.css` that puts 16px body text at roughly
six device pixels and a 44px row at roughly seventeen, until the person zooms
in. The practice's own floor for its other phone surface is a 48px target and
17px body (`docs/DESIGN-BRIEF.md` section 4.3), and the console on a phone
starts well below it.

**Which criterion this fails.** WCAG 2.2 success criterion 1.4.10, Reflow, is
not met by the console at small widths: two-dimensional scrolling is the
intended interaction there, by design. Criterion 1.4.4, Resize Text, is
unaffected, because zoom is fully available and nothing is clipped when the
person uses it.

**What a person should do instead.** The console is a desk tool. A staff member
who cannot work at that scale should open it on a tablet or a laptop, where it
reflows properly and meets the criterion. Nobody should be asked to do their
day's work pinching at a phone. If that is somebody's only device, the console
needs a reflowed layout for them and the operator should say so; the decision
is recorded as reversible for that reason.

## 4. The surfaces that do reflow

The practitioner app, the household's portal and the sign-in page all keep the
device's own width and reflow to it. Each is designed for a phone and must read
without zooming: a practitioner is standing in somebody's living room, and a
parent is reading at eleven at night. None of them is ever shown zoomed out.
The practitioner app additionally steps every type size up one and holds a 48px
minimum tap target (`docs/DESIGN-BRIEF.md` section 4.3).

## 5. What the build already gets right

- **Names survive the layout.** When the console's rail closes to a strip of
  icons its labels stay in the markup, hidden the visually-hidden way rather
  than removed, so every section keeps its accessible name. The control that
  closes it carries `aria-expanded`.
- **Colour is never the only signal.** Status is words first, with a 6px dot
  beside them (`docs/DESIGN-BRIEF.md` section 3.3, `DESIGN.md`). A person who
  cannot separate the three status hues reads the word.
- **Motion answers an action and nothing else**, at 160ms, and
  `prefers-reduced-motion` zeroes every duration in `app/shell/tokens.css`.
- **Focus is always visible**, through one `--focus` token applied by
  `:focus-visible` in `app/shell/base.css`.
- **Density has a floor.** Rows, inputs and buttons are 44px; the sign-out and
  drawer-close controls are 48px. One exception, taken deliberately on
  2026-09-12: a page listed under its section in the rail is 36px where the
  only pointer is a mouse, and the full 44px wherever a coarse pointer exists
  at all (`any-pointer: coarse`). It is a label with no icon, in a rail that
  otherwise outgrows the window with a section open
  (`docs/SPEC/coloured-shell.md` section 7.1).

## 6. What has never been checked

Stated so that nobody mistakes silence for a pass. No screen-reader pass has
been run on any surface. No contrast audit has been run against the tokens,
though they were chosen with contrast in mind. No keyboard-only walk of the
enrolment wizard, the session runner or the books has been recorded. The
generated PDF report has not been checked for tagging or reading order, which
matters because it is the artefact that circulates. Each is worth a session of
its own; none is a blocker the operator has been asked to decide.
