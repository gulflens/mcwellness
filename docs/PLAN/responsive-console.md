# McWellness Piece Nineteen: the console on any screen

Written 8 September 2026 by Claude for the operator. **Approved by the operator
on 8 September 2026** ("go ahead"), with the four decisions of 7 September
taken as below.

On 7 September at about 23:08 the operator asked for a console that adapts to
the screen it is on, said the web app will be used on a tablet or a laptop,
and said that on a phone nothing should be crammed: the page may be read in
landscape, or shown zoomed out for the person to pinch and pan. At 23:46 the
operator added that the sidebar should scroll on its own and should open and
close to make room for content.

## What is wrong today

The console has one size rule, at 720 pixels wide. Above it, every screen gets
the full desk layout whatever the screen is. Below it, the sidebar folds into a
band that wraps across the top.

Measured on the real console with its seeded practice:

| Screen | What the person sees |
| --- | --- |
| iPad, portrait | The sidebar takes 220 pixels of an 820-pixel screen. The clients table hides 209 pixels of itself. The search box and the status filter fall onto two lines with a gap beside them |
| Phone, landscape | The full desk layout on a screen 390 pixels tall. One and a half rows of the table are visible |
| Phone, portrait | The folded sidebar fills about a third of the screen before the heading starts, and the sign-out control runs off the edge |
| Laptop, 1440 | Correct, but the content stops at 1200 pixels and about 240 pixels of the display stay empty |

The practitioner's phone app and the household's portal are already right and
this piece does not touch either.

## What piece nineteen is

**Three sizes instead of one.** A laptop keeps the sidebar open with its
labels. A tablet closes the sidebar to a strip of icons and gives the width to
the content. A narrow window gets the same, with tighter margins.

**A sidebar that gets out of the way.** A control at the top opens and closes
it. Closed, it is a strip of icons, so every section is still one tap away.
The list of sections scrolls on its own, so the person's name and the way out
can never be pushed off the screen. Whichever the person chooses is remembered
on that device.

**A phone shows the whole console, zoomed out.** Rather than squeezing the
console into a phone, the page lays itself out at desk size and the phone shows
all of it, scaled down. The person pinches to zoom in and drags to move
around, the way a map works. Nothing is hidden and nothing is rearranged, so
what the person sees is the same console the laptop shows. The trade is that
the text starts small until they zoom.

**Wide displays get used.** Tables, the schedule and the books stretch to fill
a large display. Paragraphs, consent wording and settings keep their present
reading width, because a line of text 200 characters long is hard to read.

**A table too wide for its space keeps its place.** The record number and the
name stay fixed while the other columns scroll sideways inside the table. No
column is dropped and nothing is hidden. The kit register is wide enough that
this happens even on a laptop.

## What it deliberately leaves out

The practitioner's phone app is untouched. The household's portal keeps its own
phone layout, because a parent reading it at night should not have to pinch and
pan. The sign-in page stays as it is. No screen loses a column, no data is
hidden behind a menu, and the ledger keeps its look: 44-pixel rows, hairline
rules, no cards, no accent colour.

## Decisions already taken

The operator took four on 7 September, each accepting the recommendation:
the phone shows a zoomed-out desk view; the closed sidebar is a strip of icons,
closed by default on a tablet and open on a laptop; a wide display is used for
tables but not for prose; and a table too wide for its space pins its first
columns and scrolls.

One of these reverses a line in the design brief, which until now pinned the
sidebar as having no open-and-close control. The brief and the design record
are both corrected in this piece, with the date and the reason, so no two
documents disagree.

## What it costs

One session. No database change, no new table, no migration, no API route and
no new outside service. It is stylesheets, four small files in the shell and
the documents that describe them.

## What you have to do

Approve this file, which approves `docs/SPEC/responsive-console.md` as
written. When it reaches staging, open the console on your iPad in portrait and
in landscape, and on your phone, and say whether it reads right. The phone is
the one to look at hardest: it should open showing the whole page, small, and
let you pinch in.

## Builder notes

**The trunk's own worktree.** `trunk-35`
(`/Volumes/Storage/McWellness/mcwellness-trunk-35`), branch
`responsive-console`, off `main` at `0a24f85`. The shared zone is `main` only
and this piece is almost entirely inside it: `app/shell/**` and `index.html`.

**Beyond the shell** it touches three module stylesheets whose own size rules
are withdrawn into the tiers, `app/admin/schedule/schedule.css`,
`app/admin/settings/settings.css` and `app/admin/audit/audit.css`, and the one
test that reads the week's fold out of its stylesheet. Those four are listed as
a change request in `docs/CHANGE-REQUESTS/trunk-notes.md` and, by the precedent
of pieces seven to eleven, ride in this piece's own pull request.

**The step-by-step build** is
`docs/superpowers/plans/2026-09-08-responsive-console.md`, eight tasks, tests
before implementation throughout.

**The tests that matter most.** That zooming is never disabled anywhere, which
a guard test asserts across the stylesheets and the page shell. That only the
shell and three named stylesheets may declare a size rule, so a sixth
breakpoint cannot appear quietly. And that the content column can still shrink,
which is what keeps a wide table scrolling inside itself rather than dragging
the whole page sideways.

Checked as the pieces before it were: one combined review and one re-check, the
record posted, the merge, a staging pass.

## What approving this means

Approving this file approves `docs/SPEC/responsive-console.md` as written, the
four decisions above as Claude's standing until overruled, and the reversal of
the design brief's line about the sidebar.
