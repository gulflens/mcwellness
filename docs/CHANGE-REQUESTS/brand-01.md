# Change requests — brand, piece twenty

`docs/SPEC/coloured-shell.md` is a shell piece: almost everything it does
lives in the shared zone by definition, because the shell is where the
console's colour, its rail and its layout are. This request names those
paths up front rather than discovering them one at a time, and asks for the
piece to be integrated on `main` in one pass.

The spec is the *what* and the *why*; this file is only the ownership
question. Read the spec first.

---

## 1. The shared paths this piece must edit

**What.**

| Path | Change |
|---|---|
| `app/shell/tokens.css` | Six brand tokens added; `--content-max` deleted; `--brand` overridden under `[data-ground='dark']` |
| `app/shell/shell.css` | The rail's colour; the sidebar's three states; the content cap removed from `.admin__main` |
| `app/shell/base.css` | The focus ring takes `--brand` |
| `app/shell/AdminLayout.tsx` | The pinned fact, and the derived mode |
| `app/shell/railState.ts` | The second remembered fact and the pure mode function |
| `app/shell/components/Rail.tsx` | The mark, the pin control, the overlay's behaviour |
| `app/shell/viewport.ts` and its test | **Deleted** — spec section 8 |
| `index.html` | Nothing; its static viewport is what the deletion restores it to |
| `public/brand/**` | New: `mark.png`, `lockup.png`, `README.md` |
| `CLAUDE.md` | Line 34's open decision is recorded as taken |

**Why.** Spec sections 4 through 9. The piece has no entity, no migration and
no API route; it is the shell and the stylesheets that read its tokens.

## 2. Two module stylesheets outside the shell

**What.** `app/client/portal.css` and the practitioner's stylesheets under
`app/therapist/**` take the brand tokens per spec section 10 — the portal's
links and primary action, the practitioner's 56px primary action and focus
ring. Neither gains a colour literal; both read tokens, as they do today.

**Why.** The operator's decision 5: the colour reaches everywhere. Editing
them from this piece rather than filing two more requests keeps one round in
one place, and neither change can be made correctly without the tokens this
piece introduces.

## 3. The four documents that record the reversals

**What.** `DESIGN.md`, `PRODUCT.md`, `docs/DESIGN-BRIEF.md` and
`docs/SPEC/responsive-console.md` are edited so that no two documents
disagree about whether there is an accent colour, what a phone gets, or where
the content cap is.

**Why.** `CLAUDE.md` rule 10 and the precedent of
`responsive-console.md` section 6, which rewrote the design brief in the same
way when the operator reversed "no collapse toggle" on 7 September 2026. A
reversal that is not written down becomes a rule someone re-derives and
re-breaks.

## 4. What this piece does not touch

`public/icon.svg` and `public/manifest.webmanifest` — the practitioner app's
achromatic glyph, already on home screens. Migration `909_practice_logo.sql`
and the practice logo it holds, which is a practice's uploaded mark and a
different thing from the product's own. Spec section 14.
