# QA walk, 9 September 2026: the compact tier, for the first time

Walked in a real browser at **390 by 844** against this laptop's own servers
(`/Volumes/Storage/McWellness/mcwellness-portal`, its own database on port
5460, API 3021, web 5191), signed in through the laptop's own sign-in door as
the seeded people. All data is the seed's own synthetic practice — 20 clients,
6 people, 5 appointments; nowhere was a real name, number or address typed.

## Why this walk had to happen

`docs/SPEC/responsive-console.md` section 4 said plainly that "a phone
reaching the console never renders the compact tier in practice", because a
phone was served a 1024px layout and zoomed out.
`docs/SPEC/coloured-shell.md` section 8 withdrew that on 8 September, which
made the compact tier real for the first time — and it shipped to production
before anyone had opened a single screen at that width. This walk closes that
gap. It also covers the portal's new application shell
(`docs/SPEC/portal-app-shell.md`), which had been seen only in a static
harness.

## What was measured, not eyeballed

For every screen: whether the page body scrolls sideways, every element whose
box escapes the viewport outside a container allowed to scroll, and every
control under the 44px tap floor. Eyes were used afterwards, on the screens the
measurements flagged.

## The console: eight screens

| Screen | Body scrolls sideways | Overflowing | Under 44px |
|---|---|---|---|
| Clients | no | none | a table link, 22px |
| Schedule | no | none | none |
| Billing | no | none | none |
| Books | no | none | none |
| Audit | no | none | two table links, 22px |
| Settings › Practice | no | none | **the tier tabs, 35px** |
| Portal access | no | none | none |
| Kit | no | none | none |

`scrollWidth` equalled `clientWidth` at 390 on all eight. The promise
`responsive-console.md` section 10 makes — the page body never scrolls
sideways at any width — holds in the real app, and is now something somebody
has actually seen.

**The 22px table links are not defects.** They are text links inside a 44px
row; the row is the target and the link is the text within it. Raising them
would either break the row's rhythm or make every cell a button.

**The 35px tier tabs are a defect, and are fixed here.**
`.settings-nav__link` had `padding-block: 4px` and no minimum, giving 35px
against a console that gives every other target 44. It now takes
`min-block-size: var(--row)` and the nav wraps rather than overflowing, which
it would have done at a third tab.

Two console errors appear on Settings: `/api/practice/logo` 404, twice. That is
the practice's *uploaded* logo, which the seed does not write. Not a defect of
this round and not this piece's to fix; noted so the next person does not chase
it.

## The portal: six screens in the new shell

| Screen | Body scrolls sideways | Overflowing | Under 44px | Chrome |
|---|---|---|---|---|
| Home | no | none | none | 73px |
| Visits | no | none | none | 73px |
| Money | no | none | none | 73px |
| Reports | no | none | none | 73px |
| Family | no | none | a checkbox, 13px | 73px |
| Agreements | no | none | none | 73px |

**73px of chrome on every screen**, against roughly four wrapping lines
before. That is the whole point of `portal-app-shell.md`, measured.

**The 13px checkbox is not a defect.** It sits inside a `.portal__check` label
measuring 48px, and the label is the target. A native checkbox glyph is always
small; what matters is what a finger can hit.

## The one real fault, which only a browser could find

**Opening the portal's sidebar did not move focus into it.** Measured:
`focusInsideRail: false`, `document.activeElement` still `BODY`.

The cause was in this round's own CSS. The sidebar was parked with
`visibility: hidden`, and **an element with `visibility: hidden` cannot receive
focus**. `useDrawer` calls `.focus()` inside an effect, which runs before the
browser recalculates style from the new `data-nav` attribute, so the call
landed on a still-hidden element and did nothing at all — silently, with no
error.

It was not a keyboard trap: `inert` on the page behind still held, so tabbing
went into the sidebar anyway. But the intended behaviour did not happen, and
**jsdom cannot catch this**, because jsdom does not reject focus on hidden
elements. Eight passing unit tests said it worked.

**The fix** removes the hack rather than patching around it. `PortalShell` now
knows its tier, as `AdminLayout` already did, and the parked sidebar is taken
out of the tab order with the `inert` attribute — which applies the instant
React sets it, needing no style recalculation. `visibility` is gone from
`portal.css` entirely.

Re-measured in the same browser afterwards: `focusInsideRail: true`,
`activeElement: "Home"`. Escape then closes it, returns focus to the menu
button, restores `inert` on the sidebar, releases the body and removes the
scrim — all four confirmed.

`tests/portal/shell.test.tsx` gains two assertions that hold the fix: the
parked sidebar carries `inert` on a phone and does not on a tablet.

## The new interactions, confirmed in the real app

Both had only ever run in jsdom and a static harness.

**The console's covering rail** at 390: `data-rail-mode="overlay"`,
`position: fixed`, 280px wide, the scrim present, `.admin__main` inert, focus
inside the rail, the pin offered, the labels showing.

**The pin**: pressed it, then chose Billing from the rail. The route changed to
`/admin/billing` and the rail **stayed open**, `aria-pressed="true"`, with both
facts in storage (`mcwellness.rail` = `open`, `mcwellness.rail.pinned` =
`yes`). It stayed in `overlay` rather than becoming a column, which is what
section 7 of `coloured-shell.md` specifies for a phone: pinning there means it
stops closing itself, not that it pushes a 390px page aside.

## What this walk did not cover

Landscape (844 by 390). The drawer at 390 on the console's client record. The
practitioner's app, which is phone-first and was not part of these rounds.
Arabic at 390 beyond the menu's own name and the mirrored direction. A real
device, as opposed to a browser at that size.
