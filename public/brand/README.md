# The practice's mark

Cut from `logo.png` — 1794 by 876 with transparency, supplied by the operator
on 8 September 2026. Both files below come from that one source; nothing here
was redrawn, and the crop boxes are recorded so a later cut is reproducible
rather than guessed.

| File | Crop from the source | Shipped | Shown at | Size |
| --- | --- | --- | --- | --- |
| `mark.png` | (33, 129) – (671, 810) | 384 × 410 | 36px in the rail | 27.8KB |
| `lockup.png` | (33, 95) – (1761, 819) | 960 × 402 | 320px on sign-in | 39.8KB |

The crop boxes were measured from the source's own alpha channel rather than
chosen by eye: its opaque columns fall in two runs, 33–671 and 689–1761, which
are the circular mark and the wordmark with its tagline and pulse rule.

## Why these are raster, and why PNG

The brain is a dense node-and-edge illustration over a gradient. A trace of it
is a large file that is subtly wrong in the places the eye goes first, so both
assets are raster, cut at roughly three times their largest use so they stay
sharp on a high-density display.

Both are 256-colour PNGs with Floyd–Steinberg dithering. That was measured, not
assumed: against an ideal resize of the source, at the size each is actually
shown, this encoding lands at an RMS error of 3.50/255 for the mark and
4.11/255 for the lockup — *better* than WebP at quality 90 (3.58 and 4.17) and
roughly half its file size. There is therefore no format fallback to maintain:
one file each, and it is the more faithful of the two options as well as the
smaller.

## Why the rail shows the mark and not the whole lockup

The wordmark piece is 1.48:1 including "MIND • BALANCE • HEALING" and the pulse
rule beneath it. At the ~150px an open rail could give it, the tagline degrades
to grey noise and the script fights IBM Plex two lines below. The rail pairs the
circular mark with the name set in the interface's own typeface; the lockup is
shown whole where there is room for it, on sign-in and on the documents.

## The violet

`#380473`, which is `--brand` in `app/shell/tokens.css` and the same value
`domain/billing/document/render.ts` prints on an invoice. Three places now carry
that number; if it changes, all three change together.

## This is the product's mark, not a practice's

The *practice's* logo — the one an operator uploads in Settings › Practice and
the one drawn on invoices — lives in the database (migration
`909_practice_logo.sql`) and is a different thing. This one is bundled because
it has to render before any practice has loaded, and on the sign-in page where
none has.
