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
