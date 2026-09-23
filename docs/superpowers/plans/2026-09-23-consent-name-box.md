# The typed name beneath a signature keeps every letter (round 63) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person typing their name beneath the signature pad (and a reason into the consent withdrawal and erasure boxes) keeps every character they type.

**Architecture:** Four headings focus themselves through an inline `ref={(node) => { node?.focus(); }}`. React runs an inline ref callback on every render, so each keystroke's re-render moves focus back to the heading and the input loses everything after its first character. One shared hook focuses a heading once, when its panel opens, and the four sites use it. Nothing else changes.

**Tech Stack:** React 19, Vitest, @testing-library/react, @testing-library/user-event (already installed).

**Spec:** the owner's report of 23 September 2026 ("the box only allowed to input one letter … a two-word name … only its first letter"), diagnosed in this round's design: the heading's ref steals focus after every render.

## Global Constraints

- Console copy is English only; no new strings are needed.
- No personal data in tests: names come from `db/seed/names.ts` or the reserved fake ranges (`.claude/rules/testing.md`). The name in the owner's message is a real person's and must not appear anywhere in the repository.
- Tests that prove the fix must type key by key with `@testing-library/user-event` (`user.type`); `fireEvent.change` sets the whole value at once and cannot see focus loss.
- Every touched heading keeps its accessibility behaviour: it is still focused once when its panel appears (screen readers land on it), and it still carries `tabIndex={-1}`.
- `pnpm -s format` before `pnpm verify`; the gate runs prettier first.

## Review Focus

1. Drawing on the signature pad re-renders the form too (`SignaturePad.tsx` sets the signature through an effect); after the fix, drawing must not move focus off the name box if the person is mid-typing. Task 2's SignaturePad-adjacent test types, draws a stroke, and types again.
2. A heading must still receive focus when the panel first opens (the reason the ref existed). Task 1's hook test and each site test assert `toHaveFocus()` on the heading right after render.
3. Re-opening the same panel (close, open again) focuses the heading again: the hook runs on mount, and the panel unmounts when closed. Task 2 asserts it for RecordConsentForm.
4. The withdrawal reason and erasure reason are textareas or inputs with the same fault; a fix that reaches only the signature forms leaves the owner's next report waiting. Task 3 covers both.
5. Nothing else in the repository may reintroduce the pattern. Task 4 adds a guard test that greps `app/**/*.tsx` for an inline ref that calls `focus()`.

---

### Task 1: One hook that focuses a heading when it appears

**Files:**
- Create: `app/shell/hooks/useFocusOnOpen.ts`
- Test: `app/shell/hooks/useFocusOnOpen.test.tsx`

**Interfaces:**
- Produces: `export function useFocusOnOpen<T extends HTMLElement>(): React.RefObject<T | null>` — returns a ref to attach to the element; the element is focused once, in an effect after the first render, and never again while mounted.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusOnOpen } from './useFocusOnOpen';

function Panel() {
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  const [text, setText] = useState('');
  return (
    <section>
      <h3 ref={heading} tabIndex={-1}>Section</h3>
      <label>
        Name
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
    </section>
  );
}

describe('useFocusOnOpen', () => {
  it('focuses the element once when the panel appears', () => {
    render(<Panel />);
    expect(screen.getByRole('heading', { name: 'Section' })).toHaveFocus();
  });

  it('does not take focus back after a re-render', () => {
    render(<Panel />);
    const input = screen.getByLabelText('Name');
    input.focus();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('ab');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run app/shell/hooks/useFocusOnOpen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
import { useEffect, useRef } from 'react';

/**
 * Focus an element once, when the panel that holds it first appears.
 *
 * Not an inline `ref={(node) => node?.focus()}`: React runs an inline ref
 * callback on every render, so every keystroke into a field beneath the
 * heading re-rendered the form, re-ran the callback, and moved focus back to
 * the heading — a person typing their name kept one letter (round 63).
 */
export function useFocusOnOpen<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm vitest run app/shell/hooks/useFocusOnOpen.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/shell/hooks/useFocusOnOpen.ts app/shell/hooks/useFocusOnOpen.test.tsx
git commit -m "feat(shell): a hook that focuses a heading once, when its panel appears"
```

### Task 2: The two signature forms keep the typed name

**Files:**
- Modify: `app/admin/clients/RecordConsentForm.tsx:317-326` (the `<h3 className="drawer__section" tabIndex={-1} ref={(node) => { node?.focus(); }}>`)
- Modify: `app/admin/clients/SignAllForm.tsx:280-288` (the same heading)
- Test: `app/admin/clients/ConsentCapture.test.tsx` (RecordConsentForm's existing test file; add cases)
- Test: `app/admin/clients/SignAllForm.test.tsx` (add a case)

**Interfaces:**
- Consumes: `useFocusOnOpen` from Task 1.

- [ ] **Step 1: Write the failing test for RecordConsentForm**

In `ConsentCapture.test.tsx`, beside the existing "Record" flow tests (see how they open the form at ~line 516 and find the name field by its label "Name, as the person writes it"), add:

```tsx
it('keeps every letter typed into the name beneath the signature', async () => {
  const user = userEvent.setup();
  // open the Record form exactly as the neighbouring test does
  const name = await screen.findByLabelText('Name, as the person writes it');
  await user.clear(name);
  await user.type(name, 'Basil Cliff');
  expect(name).toHaveValue('Basil Cliff');
  expect(name).toHaveFocus();
});

it('lands on the heading when the form opens, and again when it is opened again', async () => {
  // open the form; assert the heading (role heading, the form's section title) has focus;
  // close it (the Cancel/close control the neighbouring tests use); open again; assert again
});
```

Use a name from `db/seed/names.ts` (the file's own tests use 'Basil Cliff' and 'Iris Harbour'; either is fine). Import `userEvent` from `@testing-library/user-event` as `EnrolmentWizard.test.tsx` does.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run app/admin/clients/ConsentCapture.test.tsx -t "every letter"`
Expected: FAIL — value is `'B'`, or focus is on the heading.

- [ ] **Step 3: Replace the inline ref in RecordConsentForm**

```tsx
const heading = useFocusOnOpen<HTMLHeadingElement>();
// …
<h3 className="drawer__section" tabIndex={-1} ref={heading}>
```

Keep the comment that says why the heading is focused; replace its claim ("Focused as it appears") with one that says once, on open, and points at the hook.

- [ ] **Step 4: Run to see it pass**

Run: `pnpm vitest run app/admin/clients/ConsentCapture.test.tsx`
Expected: PASS, the whole file.

- [ ] **Step 5: The same for SignAllForm**

Add to `SignAllForm.test.tsx` a test in the same shape (type 'Basil Cliff' key by key into the name field, expect the full value and focus), run it red, replace the inline ref at lines 280-288 with the hook, run it green.

- [ ] **Step 6: A stroke on the pad does not steal the name**

In `ConsentCapture.test.tsx`: type three letters, fire the pointer events the SignaturePad tests use to draw one stroke on the canvas (`SignaturePad.test.tsx` shows the sequence), then type the rest; expect the full name and focus on the name field. (The pad's canvas takes focus on pointer down in a real browser; jsdom does not move focus on pointer events, so assert the value survives and the field is where the hook left it.)

- [ ] **Step 7: Commit**

```bash
git add app/admin/clients/RecordConsentForm.tsx app/admin/clients/SignAllForm.tsx app/admin/clients/ConsentCapture.test.tsx app/admin/clients/SignAllForm.test.tsx
git commit -m "fix(clients): the name typed beneath a signature keeps every letter (round 63)"
```

### Task 3: The withdrawal reason and the erasure reason

**Files:**
- Modify: `app/admin/clients/ConsentTab.tsx:52-64` (`PanelHeading`, an `<h4>` with the same inline ref, used at ~378 above the withdrawal "Reason")
- Modify: `app/admin/clients/ErasureSection.tsx:115-128` (`StepHeading`, the same, used at ~517 and ~559 above the reason boxes)
- Test: `app/admin/clients/ConsentTab.test.tsx` (or the file that already exercises "Withdraw consent"; find it with `grep -rl "Withdraw consent" app/admin/clients tests`)
- Test: `app/admin/clients/ErasureSection.test.tsx` (likewise, `grep -rl "ErasureSection" app tests`)

- [ ] **Step 1: Failing tests**

For each box: open the panel the way its existing tests do, `user.type` a reason of at least twelve characters (`'typed by hand for the record'`), expect the textarea/input to hold all of it and to have focus.

- [ ] **Step 2: Run red, then replace both heading components' inline refs with `useFocusOnOpen`, run green**

`PanelHeading` and `StepHeading` are small components defined inside those files; each becomes:

```tsx
function PanelHeading({ children }: { children: React.ReactNode }) {
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  return <h4 className="…same class…" tabIndex={-1} ref={heading}>{children}</h4>;
}
```

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(clients): a reason typed for a withdrawal or an erasure keeps every letter"
```

### Task 4: A guard so the pattern cannot come back

**Files:**
- Create: `tests/lint/no-inline-focus-ref.test.ts`

Follow the shape of `tests/lint/console-is-english.test.ts` (a test that reads files and asserts on their text).

- [ ] **Step 1: Write the test**

```ts
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs'; // if unavailable on this Node, use the glob helper console-is-english.test.ts uses
import { describe, expect, it } from 'vitest';

const PATTERN = /ref=\{\s*\(\s*\w+\s*\)\s*=>\s*\{?\s*\w+\??\.focus\(\)/;

describe('focus on open', () => {
  it('is never an inline ref callback that calls focus() on every render', () => {
    const offenders = globSync('app/**/*.tsx').filter((file) => PATTERN.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

Confirm first that the pattern matches the four ORIGINAL sites (run the test against `git stash`-free history by checking the regex on the old text in your head or a scratch file), then that it passes after Tasks 2–3.

- [ ] **Step 2: Run, commit**

```bash
git add tests/lint/no-inline-focus-ref.test.ts
git commit -m "test(lint): an inline ref that calls focus() on every render is refused"
```

### Task 5: Record and gate

**Files:**
- Create: `docs/CHANGE-REQUESTS/trunk-round-63.md` — the round in the shape of `trunk-round-59.md`: the owner's report (no real name), the cause (an inline ref callback runs on every render), the four sites, the hook, the guard, and "Going live" (front-end only, no migration, no policy file).

- [ ] **Step 1: `pnpm -s format && pnpm verify`** — the whole gate green.
- [ ] **Step 2: Commit the record.**

```bash
git add docs/CHANGE-REQUESTS/trunk-round-63.md
git commit -m "docs: round 63 — the typed name keeps every letter"
```
