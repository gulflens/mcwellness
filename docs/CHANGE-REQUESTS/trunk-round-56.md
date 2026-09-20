## Round 56 — a window left open finds out there is a newer build (2026-09-20)

The operator, 20 September 2026, 06:51 +04, nine hours after the thirty-first
live pass: "the tightened client table still not reflected live".

### What was wrong, and what was not

Nothing was wrong with the pass. The site was serving the new stylesheet, byte
for byte the local build's; the index page is sent `no-store` and is not held
by the host's cache; the service worker could install, all 111 files of its
precache answering 200 with the right types; and the real Clients screen,
signed in against the seeded practice at the operator's window width, showed
the change with no spare pixel in the three columns.

What was wrong is older than the pass. The console is a single-page app, and
the operator runs it installed, in a window with no address bar and no reload
button. It fetches its own code once, when the document loads. Moving between
sections never asks the server for the app again, so a window opened before a
pass goes on running the build it started with for as long as it stays open.
Every pass since the first has had this property; this is the first time
somebody was watching for a change they had asked for.

### What it does now

When the window is looked at again (`focus`, or `visibilitychange` to visible),
and not more than once in five minutes, it fetches `/` with no cookies and no
cache and reads the name of the entry script out of the answer. Vite names that
file by its contents, so a different name is a different build. From then on
the rail's links are ordinary links (`reloadDocument`), and the next section
chosen loads the document afresh, which brings the new build with it.
`app/shell/freshBuild.ts`; `app/shell/components/Rail.tsx`.

### Two things it deliberately does not do

**It never reloads by itself.** A form half filled, a drawer open, a payment
being taken: a page that reloads under somebody loses their work. Choosing a
section is the one moment the person has already decided to leave the screen
they are on.

**It leaves the service worker alone.** Asking the worker to update would find
the new build too, and would be worse. `app/shell/sw.ts` skips waiting and
claims, so the new worker takes an old window over at once, and workbox clears
the old build's files out of the precache as it activates. The window would
then be old code holding the names of screen files that exist nowhere, on the
host or in the cache, and the next screen it opened lazily would fail to load.
Left alone, the old window keeps the old worker and the old worker keeps every
file that window can ask for, until the reload replaces all three together.

### Scope

The admin console's rail only, which is the only place `Rail` is drawn
(`app/shell/AdminLayout.tsx`). The practitioner's visit screens have no rail
and are not touched: whether a reload may happen between check-in and close is
a different question and is not answered here. The client portal is not
touched either.

On the dev server the page has no built entry to compare, so nothing is
watched. A failed answer, no signal, or a page with no entry in it all read as
"nothing new"; nothing is ever shown as an error.

### What it sends

`GET /`, the public shell every visitor is handed before they sign in, with
`credentials: 'omit'`. No personal data travels either way. The page's policy
already admits connections to its own origin.

### Checked

- `app/shell/freshBuild.test.ts`, written first: the name read from a built
  page and not from a dev or error page; same build, different build; asked
  with no cache and no cookies; on focus and not more than once in five
  minutes; stops asking once it knows; no signal, a 502 and an unreadable page
  all mean "nothing new"; nothing watched on a dev server. The pattern was also
  run against the live site's own index page and reads its entry.
- `app/shell/components/Rail.test.tsx`: a click is taken by the router while
  the builds agree, and left to the browser once they do not, to the same
  address.
- End to end in a real browser, against a production build served on a laptop
  with its service worker active: the window opened on one build and marked;
  the app rebuilt with a throwaway change and the server restarted, so the
  served entry changed and the old one answered 404, as on the host; the window
  given focus, which made one request for `/`; then Billing chosen. The
  document loaded afresh: the mark gone, the new entry running, Billing on the
  screen, still signed in, no error.
