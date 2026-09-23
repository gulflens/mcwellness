## Round 63 — the typed name beneath a signature keeps every letter (2026-09-23)

### The owner's report

On 23 September 2026 the owner reported: "the box only allowed to input one
letter" — she had typed a two-word name into the name field beneath a
signature pad and the field kept only the first letter of it. This round
diagnoses and fixes that fault, and three others in the same shape.

### The cause

Four headings across the consent screens focused themselves on open with an
inline ref callback:

```tsx
ref={(node) => {
  node?.focus();
}}
```

React runs an inline arrow function passed to `ref` again whenever its
*identity* changes, and a function literal written inline is a new identity
on every render — there is no way to tell React "this is the same callback as
last time" when it is written this way. Each of the four name and reason
fields beneath these headings is a controlled input, so every keystroke sets
state, state re-renders the form, the render creates a fresh ref callback,
React tears down the old one and runs the new one, and the new one calls
`.focus()` — moving focus, and the caret, straight back to the heading above
the field. A person typing "Basil" one keystroke at a time kept only the "B":
each subsequent letter landed on a heading that cannot hold text at all. The
same thing happened for a stroke drawn on the signature pad: `SignaturePad`
sets state through an effect when a stroke finishes, that re-renders the
form the pad sits in, and the same heading stole focus back mid-way through
whatever the person had typed into the name field so far.

### Why every existing test missed it

Every test that exercised these fields set their value with
`fireEvent.change(field, { target: { value: 'Basil Cliff' } })` — one call
that replaces the whole value in a single step, with a single render. There
is no keystroke for the ref callback to answer, so no test ever saw the
heading move focus back. The fault was invisible to `pnpm verify` until a
test types key by key, the way a person actually does, with
`@testing-library/user-event`'s `user.type()`.

### The four sites

- `app/admin/clients/RecordConsentForm.tsx` — the heading above the name
  field beneath the signature pad, on the "Record" form for a single consent.
- `app/admin/clients/SignAllForm.tsx` — the same heading, on the "Sign
  everything at once" form.
- `app/admin/clients/ConsentTab.tsx` (`PanelHeading`) — the heading above the
  withdrawal reason field.
- `app/admin/clients/ErasureSection.tsx` (`StepHeading`) — the heading above
  both erasure reason fields: the client's own erasure reason, and the reason
  a household asked with.

### The hook

`app/shell/components/useFocusOnOpen.ts` (commit `34cb8e9a`). It returns a
stable `RefObject`, not a function, and focuses the element it is attached to
exactly once, in a `useEffect` with an empty dependency array — after the
first render, and never again while the component stays mounted:

```ts
export function useFocusOnOpen<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
```

A `RefObject` is the same object on every render, so React never tears it
down and reattaches it, and the effect's empty dependency array means it
runs only on mount — a keystroke's re-render, or a signature stroke's, does
not run it again. The four sites now write `ref={heading}` instead of the
inline callback (commits `d453921d`, `babefed6`), and each panel still
focuses its heading the moment it opens — closing the panel and opening it
again focuses it afresh, because the hook re-runs on the fresh mount.

### The guard

`tests/lint/no-inline-focus-ref.test.ts` (commit `bc9944e4`, widened by
`c1c117e8`) walks every `.tsx` file under `app/` for the shape that caused
this — an inline ref callback whose body calls `.focus()` on the node it is
handed, however that body is written — and fails the build if it reappears.
A task review caught that the first pattern missed two ordinary spellings of
the same bug: a guard expression instead of a brace (`ref={(el) => el &&
el.focus()}`) and a bare, unparenthesised parameter (`ref={n =>
n?.focus()}`); the fix round widened the gap between the arrow and the
`.focus()` call from an optional single brace to a bounded stretch of up to
80 characters, and made the parameter's parentheses optional.

Two known limits, recorded rather than hidden:

- **It skips test files.** Several test files quote the old buggy shape
  verbatim inside a comment, describing the bug they now guard against
  (`ErasureSection.test.tsx`, `SignAllForm.test.tsx`,
  `ConsentCapture.test.tsx`, `useFocusOnOpen.test.tsx`); walking them would
  flag a comment, not a live callback. A `.tsx` file whose test suffix
  (`.test.tsx`) is missing — real code, not a test — is still walked.
- **The bounded stretch could span into an adjacent attribute.** The 80
  characters between `=>` and a `.focus()` call are wide enough to hold a
  guard expression or an unbraced arrow body, but nothing stops them from
  running past the end of one ref callback into an unrelated later
  `.focus()` call sitting in the next attribute or a nearby line, if such a
  file were ever written. No file in the repository does that today; the
  guard's own probe test pins the shapes it must and must not match rather
  than trusting the bound alone.

### The tests

- `app/shell/components/useFocusOnOpen.test.tsx` (new, 2 tests) — focuses the
  element once when the panel appears; does not take focus back after a
  re-render, typed key by key.
- `app/admin/clients/ConsentCapture.test.tsx` (+4 tests across the two
  commits) — keeps every letter typed into the name beneath the signature;
  lands on the heading when the form opens, and again when it is opened
  again; a stroke on the pad does not swallow the rest of the name; keeps
  every letter typed into the withdrawal reason.
- `app/admin/clients/SignAllForm.test.tsx` (+1 test) — keeps every letter
  typed into the name beneath the signature.
- `app/admin/clients/ErasureSection.test.tsx` (+2 tests) — keeps every letter
  typed into the erasure reason; keeps every letter typed into the reason a
  household asked with.
- `tests/lint/no-inline-focus-ref.test.ts` (new, 4 tests) — walks the app
  tree; does not walk test files; is never an inline ref callback that calls
  `focus()` on every render; reads the pattern wherever it is written, and
  only where it is written.

Every test above types with `@testing-library/user-event`'s `user.type()`,
key by key, not `fireEvent.change` — the one thing that could see the fault
at all.

### Going live

Front-end only. No migration, no policy file, both databases unchanged. The
pass is a build:

1. The hold protocol.
2. The code, by the recipe, and the proof read out of the served bytes.
   Identifier names are not evidence on a minified build — the production
   minifier renames them, so a name like `useFocusOnOpen` cannot be expected
   to survive into the served chunk either before or after this round. The
   proof instead reads the shape of the code:
   - Save the OLD served `ClientsPage-*.js` chunk before uploading the new
     build. It contains the minified old shape — `tabIndex:-1,ref:` followed
     within a few characters by an arrow function calling `.focus()` — found
     with a regex on the served bytes, e.g.
     `grep -oE 'tabIndex:-1,ref:[^}]{0,40}\.focus\(\)'`. The NEW chunk,
     fetched after the upload, contains no such match.
   - The old chunk's filename 404s once the new build is live, and a
     nonsense filename in the same shape 404s too (ruling out a cache or a
     wildcard route serving stale or arbitrary bytes).
   - The shell stylesheet's filename is unchanged — no CSS changed in this
     round.

### The gate

```
$ pnpm -s format && pnpm verify
```

Green. `format:check`, `eslint .`, `tsc --noEmit`, the secrets scan, the
migrations audit and `vitest run` all pass; one skipped test, pre-existing
and unrelated to this round.
