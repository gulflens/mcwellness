# SPEC — The household's portal becomes an app shell (piece twenty-two)

*Worktree: `portal`, branch `portal-app-shell`. Paths: `app/client/PortalRoot.tsx`,
`app/client/portal.css`, `app/client/i18n/dictionary.ts`, plus two shared-zone
items — one token in `app/shell/tokens.css` and one icon in
`app/shell/components/Icons.tsx`. No entity, no migration, no API route.*

Status: **built 8 September 2026.** The operator opened
`demo.mcwellnessuae.com` on a phone, said the navigation looked "really really
ugly", and asked for "the navigation to be like a real app with a sidebar menu
that can open and close, and a normal layout."

---

## 1. What was wrong, measured

The portal's header was two rows, both `flex-wrap: wrap`, above a column:

1. `.portal__bar` — mark, practice name, the language switch, the person's
   name, sign out.
2. `.portal__nav` — six tabs: Home, Visits, Money, Reports, Family,
   Agreements.

On a 390px screen neither row fitted. The bar broke onto two lines and the
tabs onto two more, orphaning "Agreements" alone on the last. Four lines of
chrome, roughly 40% of the first view, before a household saw anything about
their own record. A parent opening this at eleven at night to check tomorrow's
arrival window had to scroll past all of it.

The layout was not careless. `docs/SPEC/client-portal.md` section 3 specified
it — *"no rail"* — and for four screens with short labels on a laptop it was
right. It stopped being right at six screens on a phone, in two languages.

## 2. What it becomes

A conventional application shell.

| | Compact, below 768 | Tablet and desk, 768 and up |
|---|---|---|
| Sidebar | Not in the flow; a menu button asks for it | A column, always there |
| Opened | Covers the page over a scrim | n/a — already showing |
| Top bar | Menu button, the mark, the practice's name | The practice's name |
| Content | Full width, the measure removed | The 68-character measure |

**The sidebar holds everything that was wrapping**: the six screens, and in its
foot the person's name, the language switch and sign out. Moving those three
out of a horizontal bar is what removes the wrapping, permanently and by
construction rather than by tuning.

## 3. Hidden, not collapsed to a strip

The console's rail closes to a 64px strip of icons. The portal's does not, and
the difference is not an inconsistency:

- every console section has a drawn icon, and the strip is legible because of
  it;
- the portal's sections are words — Home, Visits, Money, Reports, Family,
  Agreements — with no icons, in two languages;
- six icons invented for this would each have to survive being read by an
  anxious non-technical adult in Arabic or English, and a wrong icon is worse
  than no icon.

So below the tablet tier the portal's sidebar is simply not there until asked
for. A menu button is a thing every household has already used.

## 4. What a covering sidebar owes the page

The same as any drawer, and it borrows the same hook — `useDrawer` in
`app/shell/components/` — rather than growing a second copy: `inert` on
everything behind it, focus held inside and returned to the button on the way
out, Escape to close, a scrim that closes on a press and is not announced.
Choosing a screen navigates and closes, so one press both goes and clears the
view.

The slide is `--motion`, which `prefers-reduced-motion` already sets to zero.
It moves on `transform` with `visibility`, so nothing inside is focusable while
it is away.

**Arabic mirrors without a second rule.** Every rule is written in logical
properties and the sidebar enters from the inline start, so the `dir="rtl"` the
portal root already sets is the whole of it. The one exception is the
`translateX` that parks it off-screen, which is a physical axis and takes a
`:dir(rtl)` rule of its own.

## 5. Colour

The sidebar takes the console rail's own treatment, so a household and the
practice see one product: `--brand-deep` ground, `--brand-pale` labels, and the
screen you are on inverted to a white plate with `--brand` on it. That last is
not a style choice but a measured one — no violet ground reaches the 3.0 a
state needs against `--brand-deep`, which `docs/SPEC/coloured-shell.md` section
4.2 records. The language switch's pressed state takes the same plate for the
same reason.

The portal's own grounds are untouched. It stays calm by brief.

## 6. Two new names

- `--portal-rail: 240px`, in `app/shell/tokens.css`. Wider than the console's
  220 because these sections are words in two scripts: "الموافقات" beside
  "Agreements" needs the room.
- `menu` in `app/client/i18n/dictionary.ts`: "Menu" / "القائمة". Every string
  on every portal screen exists in both languages, and a hardcoded one fails
  review.

## 7. One breakpoint retired

`app/client/portal.css` held a `720px` rule and
`tests/lint/one-set-of-breakpoints.test.ts` held an exception for it, reading:
*"the household's portal keeps its own phone layout by the operator's decision:
a parent reading at night should not have to pinch and pan."*

That reason was about the **console**, which was then served a 1024px layout
and zoomed out on a phone while the portal reflowed. `docs/SPEC/coloured-shell.md`
section 8 withdrew the zoomed-out treatment on 8 September 2026, so the console
now lays itself out at the phone's real width too. The distinction the
exception protected no longer exists. The portal moves to the tier boundary at
768 and the exception is deleted from the guard, which leaves one exception in
the codebase rather than two.

## 8. What this piece does not do

No screen's content changes — Home, Visits, Money, Reports, Family and
Agreements render exactly what they rendered. No API, no data, no copy beyond
the one new word. The practitioner's app and the admin console are untouched.
