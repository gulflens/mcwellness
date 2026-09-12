# SPEC — The app on a desk, a phone and a tablet

*Written 2026-09-12, on the operator's question: "guide me on how can i install
this on the client pc", and their instruction to fix what the guidance had to
apologise for.*

## 1. Why this exists

The practice runs on one person today, on whatever machine she has. The app is
a web app with a service worker and a manifest, so every platform that matters
can install it with no installer, no signing certificate and no second artefact
to review: Edge or Chrome on Windows, Chrome, Edge or Safari on a Mac, Safari's
Add to Home Screen on an iPad or an iPhone. What was missing was not machinery
but two lines of the manifest and three files.

## 2. What was wrong, stated plainly

**The manifest opened the wrong screen.** `start_url` was `/today`, the
practitioner's day sheet, because the manifest was written for her phone
(`practitioner-phone.md` section 3.1). Installed on a PC it therefore opened on
the day sheet every time, and the console — which is what the office uses — was
a click away on every launch.

**There was no raster icon at all.** The only icon was `public/icon.svg`.
Windows wants a square PNG for the taskbar and the Start menu, and Safari
accepts no SVG for `apple-touch-icon` whatsoever, so both fell back to
something generic.

**And the SVG did not parse.** Its comment named two design tokens by their CSS
spelling, with two leading hyphens. A double hyphen is illegal inside an XML
comment and an SVG document is parsed as XML, so the file was malformed from
the day it was written: every browser asked for the installable icon got a
parse error rather than a mark. Nothing caught it, because the console draws
its own mark from `public/brand/mark.png` and a browser that cannot parse an
icon simply shows none. Found on 2026-09-12 while rasterising it.

## 3. What the manifest says now

`start_url` is `/`, which is right for everybody: the app already sends each
person to their own home screen by role, so the practitioner still lands on the
day sheet and the office lands on the console. `orientation` is gone — it was
`portrait`, which means nothing on a desk and is presumptuous on a tablet.
`display` stays `standalone`, and the two colours stay the practitioner
ground's, copied verbatim from the tokens as they have always been.

The icons are `icon.svg` (any size), `icon-192.png`, and `icon-512.png` twice,
once plain and once `maskable`, so Android may crop it to its own shape without
clipping the glyph. `index.html` carries `apple-touch-icon.png` at 180×180,
which is the size and the format Safari asks for.

Three `shortcuts` — Clients, Schedule, Billing — give a right-click on the
Windows taskbar icon a way straight into the three screens the office opens
most. A person who may not open one is sent home by the route, as they are from
any other door.

**The PNGs are rendered from `public/icon.svg`** and are not drawn separately:
one mark, three sizes. `tests/lint/manifest-installs-the-console.test.ts` holds
the manifest's shape and the files' real dimensions, and
`tests/lint/svg-parses.test.ts` refuses an SVG that does not parse — the guard
the malformed comment earned.

## 4. What is still not built

No badge, no push, no file handlers, no protocol handlers: none is asked for.
If the amplifier is ever to talk to the app directly, that needs WebUSB or Web
Serial, which Chrome and Edge have and Safari does not — a decision for the day
someone wants it, not before.

## 5. How the PNGs are made, and why not with a thumbnailer

They are rendered by an exact rasteriser rather than converted by a tool that
happened to be installed. The first attempt used macOS Quick Look, which
**composites onto a white matte**: the three icons came out with opaque white
wedges in the corners where the mark's rounded square is transparent, which on
a dark Windows taskbar or in a dark tab strip is precisely the poor icon this
was meant to end. The review of pull request 165 measured it — pixel (0,0)
opaque white, no transparent pixel anywhere — before it shipped.

The mark is a rounded square and one glyph of straight lines only, so both are
computable: the corners are four circles of radius 96 in a 512 box, the glyph
is a thirteen-point polygon, and a 4×4 supersample gives the edges. Nothing is
drawn by hand twice and nothing is traced.

**Each file is what its platform wants, and they differ:**

| File | Shape | Corners | Why |
|---|---|---|---|
| `icon-192.png`, `icon-512.png` | rounded | transparent | The icon is the mark, and a browser puts it on whatever ground it likes. |
| `icon-512-maskable.png` | full bleed | opaque | Android applies its own mask; a maskable icon that is already rounded is cropped twice. |
| `apple-touch-icon.png` | full bleed | opaque | Apple renders transparency as black and applies its own rounding. |

The glyph's farthest corner is 155px from the centre of a 512 box, inside the
205px radius a maskable icon's safe zone allows, so no mask can clip it.
`tests/lint/manifest-installs-the-console.test.ts` holds each file's size and
whether its corner is transparent, which is the property that went wrong.
