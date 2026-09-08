# The practice's colour and the shell that carries it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the interface the practice's violet, put the practice's mark in it, let the console fill any display, and give the sidebar a strip / overlay / pinned life that works on a phone.

**Architecture:** Almost all of it is `app/shell/tokens.css`, because every colour and size in this app is a token and no component carries a literal. The rail's new look is a re-colouring of rules that already exist; the sidebar's new behaviour is one pure function plus one boolean of remembered state; the phone change is a deletion. The band spectrum and the three status colours are not touched, and a guard test holds that line.

**Tech Stack:** TypeScript, React 19, Vite, vitest + @testing-library/react, plain CSS with custom properties. `pnpm` only.

**Spec:** `docs/SPEC/coloured-shell.md` — read it whole before starting. `docs/CHANGE-REQUESTS/brand-01.md` names the shared paths.

## Global Constraints

- **No hex literal outside `app/shell/tokens.css`.** `tests/lint/no-hex-colour.test.ts` enforces it through eslint. Every colour is a token.
- **Logical properties only** (`inline-start`, `block-end`, `padding-inline`). The Arabic edition is a mirrored layout, never a flipped one.
- **No width may be written outside the tiers.** `tests/lint/one-set-of-breakpoints.test.ts` enforces it. The tiers are 768 and 1200.
- **Zoom is never taken away.** Neither `user-scalable=no` nor `maximum-scale` may appear anywhere. `tests/lint/layout-tokens.test.ts` enforces it.
- **The console is English only** (`tests/lint/console-is-english.test.ts`).
- **British English, no emoji, no ALL-CAPS labels, no arrows on buttons.**
- **The brand violet is `#380473`** on light grounds and `#a96cef` on dark. Both values are fixed by measurement in spec section 4; do not adjust them by eye.
- Run `pnpm verify` before any task is called done. It is `format:check`, `lint`, `typecheck`, `audit:secrets`, `audit:migrations`, `test`.
- Commit after every task. Conventional messages, one purpose each.

---

### Task 1: The brand tokens, and a test that they stay legible

**Files:**
- Modify: `app/shell/tokens.css:96-99` (the sizes block) and `:113` (the dark ground)
- Create: `tests/lint/brand-contrast.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--brand`, `--brand-deep`, `--brand-lift`, `--brand-pale`, `--brand-wash`, `--brand-magenta`, read by every later task.

- [ ] **Step 1: Write the failing test**

Create `tests/lint/brand-contrast.test.ts`. It parses the real stylesheet, so a token edited to something illegible fails the build:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync('app/shell/tokens.css', 'utf8');

/** The value of a custom property, from the block that declares it last. */
function token(name: string, block?: string): string {
  const source = block ? (tokens.split(block)[1] ?? '') : tokens;
  const found = [...source.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'g'))];
  const last = found.at(block ? 0 : -1);
  if (!last) throw new Error(`no ${name} in ${block ?? 'tokens.css'}`);
  return last[1];
}

function channel(pair: string): number {
  const c = parseInt(pair, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(hex.slice(i, i + 2)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const AA_TEXT = 4.5;
const AA_UI = 3;

describe('the brand palette stays legible', () => {
  const brand = token('--brand');
  const deep = token('--brand-deep');
  const pale = token('--brand-pale');
  const paper = token('--paper');
  const surface = token('--surface');

  it('carries a label on the rail', () => {
    expect(contrast(pale, deep)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(surface, deep)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('separates the active pill from the rail it sits on', () => {
    expect(contrast(surface, deep)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('reads as text on the active pill and on paper', () => {
    expect(contrast(brand, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(brand, paper)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('carries white on a filled control', () => {
    expect(contrast('#ffffff', brand)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('is lifted enough to read on the practitioner ground', () => {
    const dark = token('--brand', "[data-ground='dark']");
    const darkPaper = token('--paper', "[data-ground='dark']");
    const darkSurface = token('--surface', "[data-ground='dark']");
    expect(contrast(dark, darkPaper)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(dark, darkSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    // Dark text on it too, so one token serves a link and a filled control.
    expect(contrast(darkPaper, dark)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/lint/brand-contrast.test.ts`
Expected: FAIL — `no --brand in tokens.css`.

- [ ] **Step 3: Add the tokens**

In `app/shell/tokens.css`, after the status block and before the font, insert:

```css
  /* The practice's own violet, sampled from the mark rather than chosen
     (docs/SPEC/coloured-shell.md section 4): #380473 is the mark's circle, and
     the same value domain/billing/document/render.ts already prints on every
     invoice. The hue is 268deg throughout; only lightness moves.

     The active section is a white pill, not a tinted row: no violet ground
     reaches the 3.0 a state needs against --brand-deep, the best of six
     candidates measuring 1.99 (spec section 4.2). */
  --brand: #380473;
  --brand-deep: #2b0359;
  --brand-lift: #480594;
  --brand-pale: #eadff6;
  --brand-wash: #f6f1fb;
  /* The brain's pink. Declared so the mark's second colour is written down
     where the first is; used nowhere yet, and a guard test keeps it that way. */
  --brand-magenta: #d81c7c;
```

In the same file, change the focus ring so the app's attention colour is the practice's:

```css
  --focus: 0 0 0 2px var(--paper), 0 0 0 4px var(--brand);
```

In the `[data-ground='dark']` block, beneath the band lifts, add:

```css
  /* Mixing towards white passes but yields a lilac that stops reading as the
     practice's colour, so the lift holds saturation: L 68%, S 80%, hue held
     (spec section 4.3). Passes AA in both directions, so one token serves a
     link on this ground and a filled control with dark text on it. --brand is
     the only one of the six this ground overrides; the other five describe a
     rail this app does not have. */
  --brand: #a96cef;
```

- [ ] **Step 4: Run the test and the guards**

Run: `pnpm vitest run tests/lint/`
Expected: PASS, including `no-hex-colour` (tokens.css is where hexes belong).

- [ ] **Step 5: Commit**

```bash
git add app/shell/tokens.css tests/lint/brand-contrast.test.ts
git commit -m "feat(shell): the practice's violet, sampled from the mark and measured"
```

---

### Task 2: The coloured rail

**Files:**
- Modify: `app/shell/shell.css` — the `.rail*` rules at 34-140 and the `[data-rail='closed']` block at ~481

- [ ] **Step 1: Colour the rail**

`.rail` takes the deep violet and loses its hairline, which has nothing to divide once the ground changes:

```css
.rail {
  position: sticky;
  inset-block-start: 0;
  block-size: 100dvh;
  display: flex;
  flex-direction: column;
  padding: var(--s-4) var(--s-2);
  background: var(--brand-deep);
  color: var(--brand-pale);
  overflow: hidden;
}
```

Labels, icons and the person's name inherit `--brand-pale`. The active pill and its hover:

```css
.rail__item {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-block-size: var(--row);
  padding-inline: var(--s-3);
  border-radius: var(--r-2);
  text-decoration: none;
  color: var(--brand-pale);
}

a.rail__item:hover {
  background: var(--brand-lift);
  color: var(--surface);
}

.rail__item--active,
a.rail__item.rail__item--active {
  color: var(--brand);
  background: var(--surface);
  font-weight: var(--w-medium);
}

.rail__item--later {
  color: var(--brand-pale);
  opacity: 0.62;
}
```

The rule above the person's block, and the sign-out control:

```css
.rail__person {
  flex: none;
  margin-block-start: var(--s-4);
  padding: var(--s-4) var(--s-3) 0;
  border-block-start: var(--hairline) solid var(--brand-lift);
}

.rail__signout {
  color: var(--brand-pale);
}

.rail__signout:hover,
.rail__toggle:hover {
  color: var(--surface);
}

.rail__toggle {
  color: var(--brand-pale);
}
```

Delete the three rules the old palette needed and the new one contradicts: `a.rail__item { color: var(--ink); }`, `.rail__item--later { color: var(--ink-2); }` and `.rail__item--later svg`'s slate, near line 554. Also delete `border-inline-end: var(--hairline) solid var(--rule);` from `.rail`.

- [ ] **Step 2: Fix the roles line**

The roles line under the person's name renders `.micro`, which is `--ink-2` — invisible on violet. Its violet equivalent `#9b69d3` measures 4.25 and fails, so it takes the same pale as every label and is separated by size alone:

```css
.rail__person .micro {
  color: var(--brand-pale);
}
```

- [ ] **Step 3: Look at it**

Run: `pnpm dev:web`, open `/admin/clients`, sign in with the dev account. Check: the active section is a white pill with violet text; every label is legible; the roles line is readable; hover shows.

- [ ] **Step 4: Run the guards**

Run: `pnpm -s format:check && pnpm -s lint && pnpm vitest run tests/lint/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/shell/shell.css
git commit -m "feat(shell): the rail takes the practice's violet"
```

---

### Task 3: The mark

**Files:**
- Create: `public/brand/mark.png`, `public/brand/lockup.png`, `public/brand/README.md`
- Modify: `app/shell/components/Rail.tsx:73-75`, `app/shell/shell.css` (`.rail__mark`)

**Interfaces:**
- Produces: `/brand/mark.png` and `/brand/lockup.png` as absolute URLs any screen may reference.

- [ ] **Step 1: Cut the two assets**

Source: `/Volumes/Storage/McWellness/Documents/logo.png`, 1794×876 with transparency, supplied by the operator on 8 September 2026. Crop boxes measured from the alpha channel's column profile.

```bash
python3 - <<'PY'
from PIL import Image
src = Image.open('/Volumes/Storage/McWellness/Documents/logo.png').convert('RGBA')
Path = 'public/brand/'
# The circular mark alone, for the rail and the strip.
mark = src.crop((33, 129, 671, 810))
mark.resize((384, round(384 * mark.height / mark.width)), Image.LANCZOS).save(
    Path + 'mark.png', optimize=True)
# The full lockup, for sign-in.
lock = src.crop((33, 95, 1761, 819))
lock.resize((960, round(960 * lock.height / lock.width)), Image.LANCZOS).save(
    Path + 'lockup.png', optimize=True)
PY
ls -la public/brand/
```

Budgets from spec section 6: `mark.png` ≤ 40KB, `lockup.png` ≤ 120KB. If either is over, re-save as WebP and reference it through `<picture>` with the PNG as fallback.

- [ ] **Step 2: Write the provenance**

`public/brand/README.md`:

```markdown
# The practice's mark

Cut from `logo.png`, 1794 by 876 with transparency, supplied by the operator on
8 September 2026. Both files below come from that one source; nothing here was
redrawn, and the crop boxes are recorded so a later cut is reproducible rather
than guessed.

| File | Crop from the source | Shipped at |
|---|---|---|
| `mark.png` | (33, 129) – (671, 810) | 384px wide |
| `lockup.png` | (33, 95) – (1761, 819) | 960px wide |

Both are shipped at roughly three times their largest use, so they stay sharp
on a high-density display. They are raster rather than traced: the brain is a
dense node-and-edge illustration over a gradient, and a trace of it is large
and subtly wrong in the places the eye goes first.

The violet in these files is `#380473`, which is `--brand` in
`app/shell/tokens.css` and the same value `domain/billing/document/render.ts`
prints on an invoice. Three places now carry that number; if it changes, all
three change together.

This is the *product's* mark. The *practice's* logo — the one an operator
uploads in Settings and the one drawn on invoices — lives in the database
(migration `909_practice_logo.sql`) and is a different thing.
```

- [ ] **Step 3: Put the mark in the rail**

In `app/shell/components/Rail.tsx`, replace the wordmark div:

```tsx
      <div className="rail__head">
        <img className="rail__logo" src="/brand/mark.png" alt="" width={36} height={38} />
        <div className="rail__mark rail__label">McWellness</div>
```

The `alt` is empty on purpose: the name is beside it in text, so a screen reader that announced both would say it twice.

In `shell.css`:

```css
.rail__logo {
  flex: none;
  inline-size: 36px;
  block-size: auto;
}

.rail__mark {
  font-weight: var(--w-medium);
  font-size: var(--t-h3);
  line-height: var(--lh-h3);
  padding-inline-start: var(--s-2);
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--surface);
}
```

Closed, the strip shows the mark alone and centred — `.rail__label` is already hidden by the existing `[data-rail='closed']` rule, so only the head's centring needs to hold.

- [ ] **Step 4: Test that the mark is there and unannounced**

In `app/shell/components/Rail.test.tsx`, add:

```tsx
it('shows the practice mark without announcing it twice', () => {
  render(
    <MemoryRouter>
      <Rail person={{ name: 'A', roles: 'Owner' }} onSignOut={() => {}} open onToggle={() => {}} />
    </MemoryRouter>,
  );
  const logo = document.querySelector('.rail__logo');
  expect(logo).toBeTruthy();
  expect(logo?.getAttribute('alt')).toBe('');
  expect(screen.getByText('McWellness')).toBeTruthy();
});
```

Run: `pnpm vitest run app/shell/components/Rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/brand app/shell/components/Rail.tsx app/shell/components/Rail.test.tsx app/shell/shell.css
git commit -m "feat(shell): the practice's mark in the rail, cut from the operator's file"
```

---

### Task 4: The sidebar's three states, as a pure function

**Files:**
- Modify: `app/shell/railState.ts`, `app/shell/railState.test.ts`

**Interfaces:**
- Produces: `tierOf(width): Tier`, `railMode(tier, open, pinned): RailMode`, `closesOnChoice(tier, pinned): boolean`, `PIN_KEY`, `readPinned(store): boolean`, `writePinned(store, pinned): void`. Task 5 consumes all of them.

- [ ] **Step 1: Write the failing tests**

Append to `app/shell/railState.test.ts`:

```ts
describe('tierOf', () => {
  it('names the three tiers at their boundaries', () => {
    expect(tierOf(1200)).toBe('desk');
    expect(tierOf(1199)).toBe('tablet');
    expect(tierOf(768)).toBe('tablet');
    expect(tierOf(767)).toBe('compact');
    expect(tierOf(390)).toBe('compact');
  });
});

describe('railMode', () => {
  it('is a column on a desk, whichever way it is set', () => {
    expect(railMode('desk', true, false)).toBe('column-open');
    expect(railMode('desk', false, false)).toBe('column-strip');
    // Pinning means nothing on a desk: the rail is already a column.
    expect(railMode('desk', true, true)).toBe('column-open');
    expect(railMode('desk', false, true)).toBe('column-strip');
  });

  it('is a strip below the desk until it is opened', () => {
    expect(railMode('tablet', false, false)).toBe('column-strip');
    expect(railMode('compact', false, false)).toBe('column-strip');
    expect(railMode('tablet', false, true)).toBe('column-strip');
    expect(railMode('compact', false, true)).toBe('column-strip');
  });

  it('covers the content when opened, and pushes it when pinned on a tablet', () => {
    expect(railMode('tablet', true, false)).toBe('overlay');
    expect(railMode('tablet', true, true)).toBe('column-open');
  });

  it('still covers on a phone even when pinned, because 220px would leave 170', () => {
    expect(railMode('compact', true, false)).toBe('overlay');
    expect(railMode('compact', true, true)).toBe('overlay');
  });
});

describe('closesOnChoice', () => {
  it('closes behind you below the desk unless you pinned it', () => {
    expect(closesOnChoice('compact', false)).toBe(true);
    expect(closesOnChoice('tablet', false)).toBe(true);
    expect(closesOnChoice('compact', true)).toBe(false);
    expect(closesOnChoice('tablet', true)).toBe(false);
  });

  it('never closes on a desk, where choosing a section does not move the rail', () => {
    expect(closesOnChoice('desk', false)).toBe(false);
    expect(closesOnChoice('desk', true)).toBe(false);
  });
});

describe('readPinned / writePinned', () => {
  it('remembers the choice and defaults to unpinned', () => {
    const store = emptyStore();
    expect(readPinned(store)).toBe(false);
    writePinned(store, true);
    expect(store.getItem(PIN_KEY)).toBe('yes');
    expect(readPinned(store)).toBe(true);
    writePinned(store, false);
    expect(readPinned(store)).toBe(false);
  });

  it('says nothing when storage refuses or is absent', () => {
    expect(readPinned(refusing)).toBe(false);
    expect(readPinned(undefined)).toBe(false);
    expect(() => writePinned(refusing, true)).not.toThrow();
    expect(() => writePinned(undefined, true)).not.toThrow();
  });
});
```

Extend the import at the top of the file to bring in `PIN_KEY`, `closesOnChoice`, `railMode`, `readPinned`, `tierOf`, `writePinned`.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run app/shell/railState.test.ts`
Expected: FAIL — the new names do not exist.

- [ ] **Step 3: Implement**

Append to `app/shell/railState.ts`:

```ts
/** The tablet tier's boundary, the same 768px `shell.css` changes padding at. */
const TABLET = 768;

export type Tier = 'compact' | 'tablet' | 'desk';

/**
 * Which of the three tiers a width is in (docs/SPEC/responsive-console.md
 * section 4). One vocabulary; no screen writes a width of its own.
 */
export function tierOf(viewportWidth: number): Tier {
  if (viewportWidth >= DESK) return 'desk';
  return viewportWidth >= TABLET ? 'tablet' : 'compact';
}

/** How the rail is standing: a column of either width, or floating over the page. */
export type RailMode = 'column-open' | 'column-strip' | 'overlay';

/**
 * The rail's mode, derived from the tier and the two remembered facts and
 * never stored (docs/SPEC/coloured-shell.md section 7).
 *
 * On a desk the rail is a column and pinning means nothing: it is already
 * held open. Below the desk the strip is what rests on the screen, opening
 * floats the labels over the page, and pinning keeps them. Pinning pushes the
 * content aside only on a tablet — a 220px rail on a 390px phone would leave
 * 170px of page, so on a phone pinning means only that the rail stops closing
 * itself, which is what a person pinning it there actually wants.
 */
export function railMode(tier: Tier, open: boolean, pinned: boolean): RailMode {
  if (tier === 'desk') return open ? 'column-open' : 'column-strip';
  if (!open) return 'column-strip';
  return tier === 'tablet' && pinned ? 'column-open' : 'overlay';
}

/** Whether choosing a section should put the rail away behind you. */
export function closesOnChoice(tier: Tier, pinned: boolean): boolean {
  return tier !== 'desk' && !pinned;
}

/** Whether the rail is pinned, remembered on this device. Holds one word. */
export const PIN_KEY = 'mcwellness.rail.pinned';

export function readPinned(store: Storage | undefined): boolean {
  if (!store) return false;
  try {
    return store.getItem(PIN_KEY) === 'yes';
  } catch {
    // A private window may refuse storage. Unpinned is the safe answer: the
    // rail closes behind you rather than sitting over a page you cannot read.
    return false;
  }
}

export function writePinned(store: Storage | undefined, pinned: boolean): void {
  if (!store) return;
  try {
    store.setItem(PIN_KEY, pinned ? 'yes' : 'no');
  } catch {
    // Their choice lasts for this visit rather than the next one.
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run app/shell/railState.test.ts`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add app/shell/railState.ts app/shell/railState.test.ts
git commit -m "feat(shell): the rail's three modes, derived from the tier and two facts"
```

---

### Task 5: Wire the modes, the pin control and the overlay

**Files:**
- Modify: `app/shell/AdminLayout.tsx`, `app/shell/components/Rail.tsx`, `app/shell/shell.css`, `app/shell/components/Rail.test.tsx`, `app/shell/App.test.tsx`

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces: `.admin[data-rail-mode]` on the layout root, taking `column-open`, `column-strip` or `overlay`.

- [ ] **Step 1: Hold the tier, and both facts, in the layout**

In `AdminLayout.tsx`, replace the single `railOpen` state with the tier and the two facts. The tier follows the window, because a person rotates a tablet and drags a laptop window:

```tsx
const [width, setWidth] = useState(() => window.innerWidth);
useEffect(() => {
  const onResize = () => setWidth(window.innerWidth);
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);
const [railOpen, setRailOpen] = useState(() => readRail(store(), window.innerWidth));
const [pinned, setPinned] = useState(() => readPinned(store()));
const tier = tierOf(width);
const mode = railMode(tier, railOpen, pinned);
```

The toggle and the pin each write their own fact:

```tsx
const toggleRail = () => {
  setRailOpen((wasOpen) => {
    const open = !wasOpen;
    writeRail(store(), open);
    return open;
  });
};
const togglePin = () => {
  setPinned((wasPinned) => {
    const next = !wasPinned;
    writePinned(store(), next);
    return next;
  });
};
const chooseSection = () => {
  if (closesOnChoice(tier, pinned)) {
    setRailOpen(false);
    writeRail(store(), false);
  }
};
```

The root carries both attributes; `data-rail` stays because `shell.css` and `layout-tokens.test.ts` both read it:

```tsx
<div className="admin" data-rail={railOpen ? 'open' : 'closed'} data-rail-mode={mode}>
  <Rail
    person={{ name: actorName, roles }}
    sections={sections}
    onSignOut={() => void signOut()}
    open={railOpen}
    onToggle={toggleRail}
    pinned={pinned}
    onTogglePin={tier === 'desk' ? undefined : togglePin}
    onChoose={chooseSection}
  />
```

- [ ] **Step 2: Take the new props in the Rail**

`Rail.tsx` gains three optional props. The pin control renders only when `onTogglePin` is given and the rail is open — on a desk it is absent, and the 64px strip has room for one control and nothing for a second to do:

```tsx
  pinned = false,
  onTogglePin,
  onChoose,
}: {
  /* …existing… */
  /** Whether the rail is held open across navigation. */
  pinned?: boolean;
  /** Absent on a desk, where the rail is a column and pinning means nothing. */
  onTogglePin?: () => void;
  /** Called when a section is chosen, so the layout may put the rail away. */
  onChoose?: () => void;
}) {
```

In the head, after the toggle:

```tsx
        {onTogglePin && open ? (
          <button
            type="button"
            className="rail__pin"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title="Keep sections open"
          >
            <PinIcon />
            <span className="visually-hidden">Keep sections open</span>
          </button>
        ) : null}
```

Every `NavLink` gains `onClick={onChoose}`.

Add `PinIcon` to `app/shell/components/Icons.tsx`, following the shape of the icons already there — 20px viewBox, `currentColor`, no fill.

- [ ] **Step 3: Style the three modes**

In `shell.css`. The overlay floats the rail above the content and lays a scrim over the page:

```css
/* Covering: the rail floats over the page rather than squeezing it, and the
   grid still reserves the strip beneath (docs/SPEC/coloured-shell.md
   section 7). */
.admin[data-rail-mode='overlay'] {
  --rail: var(--rail-closed);
}

.admin[data-rail-mode='overlay'] .rail {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--rail-open);
  z-index: 2;
  box-shadow: var(--shadow);
}

.admin[data-rail-mode='overlay'] .rail__label,
.admin[data-rail-mode='overlay'] .rail__later {
  position: static;
  inline-size: auto;
  block-size: auto;
  clip-path: none;
}

.admin[data-rail-mode='overlay'] .rail__item,
.admin[data-rail-mode='overlay'] .rail__signout {
  justify-content: flex-start;
  padding-inline: var(--s-3);
}

.admin__scrim {
  position: fixed;
  inset: 0;
  z-index: 1;
  border: 0;
  padding: 0;
  background: color-mix(in srgb, var(--ink) 44%, transparent);
}
```

The scrim is a `button` with `aria-hidden="true"` and `tabIndex={-1}`, rendered by `AdminLayout` only in `overlay` mode; pressing it calls the toggle. It is not announced because Escape and the toggle are the announced ways out.

- [ ] **Step 4: Escape, and focus**

In `Rail.tsx`, while the mode is `overlay`, an effect listens for Escape and calls `onToggle`; focus moves to the rail when it opens and returns to the toggle when it closes. `app/shell/components/useDrawer.ts` already does exactly this for the drawer — read it and follow it rather than writing a second version. If it is general enough, use it directly.

- [ ] **Step 5: Test the behaviour**

In `Rail.test.tsx`:

```tsx
it('offers no pin on a desk, where the rail is already a column', () => {
  render(
    <MemoryRouter>
      <Rail person={{ name: 'A', roles: 'Owner' }} onSignOut={() => {}} open onToggle={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.queryByTitle('Keep sections open')).toBeNull();
});

it('says whether it is pinned', () => {
  render(
    <MemoryRouter>
      <Rail
        person={{ name: 'A', roles: 'Owner' }}
        onSignOut={() => {}}
        open
        onToggle={() => {}}
        pinned
        onTogglePin={() => {}}
      />
    </MemoryRouter>,
  );
  expect(screen.getByTitle('Keep sections open').getAttribute('aria-pressed')).toBe('true');
});

it('tells the layout when a section is chosen', async () => {
  const onChoose = vi.fn();
  render(
    <MemoryRouter>
      <Rail
        person={{ name: 'A', roles: 'Owner' }}
        onSignOut={() => {}}
        open
        onToggle={() => {}}
        onChoose={onChoose}
      />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByText('Clients'));
  expect(onChoose).toHaveBeenCalled();
});
```

Run: `pnpm vitest run app/shell/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/shell/
git commit -m "feat(shell): the sidebar covers, pins and closes behind you"
```

---

### Task 6: The full width, and the phone at its own width

**Files:**
- Modify: `app/shell/shell.css:28-32`, `app/shell/tokens.css:98-99`, `app/shell/App.tsx:43,129`
- Delete: `app/shell/viewport.ts`, `app/shell/viewport.test.ts`
- Modify: `tests/lint/layout-tokens.test.ts` (the exemption the deleted module needed)

- [ ] **Step 1: Remove the cap**

In `shell.css`, `.admin__main` loses its last line:

```css
.admin__main {
  min-inline-size: 0;
  padding: var(--s-4) var(--s-4) var(--s-12);
}
```

In `tokens.css`, delete `--content-max` and the comment above it. It has exactly one reader — `shell.css` line 31 — and a token nothing reads is a trap. Keep `--measure`; nine rules read it and none of them changes.

- [ ] **Step 2: Delete the phone's zoom-out**

```bash
git rm app/shell/viewport.ts app/shell/viewport.test.ts
```

In `App.tsx`, remove the import on line 43 and the `useViewport(pathname)` call on line 129. `index.html` already declares `width=device-width, initial-scale=1` and now nothing rewrites it.

In `tests/lint/layout-tokens.test.ts`, remove the exemption that named `app/shell/viewport.ts`. The guard itself — that neither `user-scalable=no` nor `maximum-scale` appears anywhere — stays exactly as it is and now has no exceptions at all, which is stronger.

- [ ] **Step 3: Run everything**

Run: `pnpm verify`
Expected: PASS. If `App.test.tsx` asserted the viewport meta, remove that assertion with the module.

- [ ] **Step 4: Walk the compact tier**

The compact tier stops being theoretical here. With `pnpm dev:web`, at 390px wide, open each of: clients, schedule, billing, books, audit, settings, portal, kit. Look for anything that overflows the page sideways, any control under 44px, any text that collides. Three things already cover most of it — tables pin and scroll in their own container, a toolbar field takes the whole line below 768px, and the drawer takes the full width. Fix what those do not cover, in this task, in `shell.css` or the module stylesheet that owns the screen.

- [ ] **Step 5: Commit**

```bash
git add -A app/shell tests/lint/layout-tokens.test.ts
git commit -m "feat(shell): the console fills the display, and a phone gets its own width"
```

---

### Task 7: The colour everywhere else

**Files:**
- Modify: `app/shell/pages/SignInPage.tsx:60`, `app/shell/shell.css` (`.signin__mark`), `app/client/portal.css`, `app/therapist/today/today.css`, `app/therapist/session/SessionRunner.css`, `app/therapist/session/CheckInPage.css`

- [ ] **Step 1: The lockup on sign-in**

Replace the text mark with the artwork, at a size that lets it be read:

```tsx
      <img className="signin__logo" src="/brand/lockup.png" alt="McWellness" width={320} height={134} />
```

```css
.signin__logo {
  inline-size: 320px;
  max-inline-size: 100%;
  block-size: auto;
  padding-block-end: var(--s-3);
  border-block-end: var(--hairline) solid var(--rule);
}
```

Here the `alt` carries the name, because unlike the rail there is no text beside it. Delete the `.signin__mark` rules that styled the text.

- [ ] **Step 2: The portal**

`app/client/portal.css`: the header gains the mark beside the practice's name at 32px; links and the primary action take `--brand`. The grounds do not change — the portal is calm by brief and colour arrives there as identity, not decoration.

- [ ] **Step 3: The practitioner's app**

Under `[data-ground='dark']`, `--brand` is already `#a96cef` from Task 1. The 56px primary action in the thumb zone takes it, and so does the focus ring through `--focus`. Nothing else: **the ribbon, the offline band and every band figure are untouched.** On the Today landing the mark sits on a white circular plate, because its own violet circle is 1.22 against that near-black and would vanish:

```css
.today__logo {
  inline-size: 40px;
  padding: var(--s-1);
  border-radius: 50%;
  background: var(--surface);
}
```

Put the plated mark and the bare mark side by side and look at both before settling, per spec section 6.

- [ ] **Step 4: Run everything**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/shell/pages app/shell/shell.css app/client app/therapist
git commit -m "feat(shell): the practice's colour on sign-in, the portal and the practitioner's app"
```

---

### Task 8: The guard that keeps colour meaningful, and the documents

**Files:**
- Create: `tests/lint/colour-keeps-its-meaning.test.ts`
- Modify: `CLAUDE.md:34`, `PRODUCT.md:158-163`, `DESIGN.md:213,254,431`, `docs/DESIGN-BRIEF.md`, `docs/SPEC/responsive-console.md`

- [ ] **Step 1: Write the failing guard**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(?:css|tsx?)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const BAND = /--(?:delta|theta|alpha|beta|gamma)\b/;
const BRAND = /--brand\b/;
const TOKENS = 'app/shell/tokens.css';

/**
 * Colour means one thing at a time (docs/SPEC/coloured-shell.md section 11).
 * The brand violet never enters a chart's plotting area and no band hue is
 * ever used for chrome, so a colour inside a figure is always a measurement.
 * --delta-base is an indigo and measures 1.76 against --brand; they are safe
 * only because they never meet.
 */
describe('colour keeps its meaning', () => {
  const files = sources('app').filter((path) => path !== TOKENS);

  it('never puts the brand in a file that draws band data', () => {
    const both = files.filter((p) => {
      const text = readFileSync(p, 'utf8');
      return BAND.test(text) && BRAND.test(text);
    });
    expect(both).toEqual([]);
  });

  it('never puts a band hue in the shell', () => {
    const shell = files.filter((p) => p.startsWith(join('app', 'shell')));
    const offenders = shell.filter((p) => BAND.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it("keeps the mark's second colour reserved until something needs it", () => {
    const used = files.filter((p) => /--brand-magenta/.test(readFileSync(p, 'utf8')));
    expect(used).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/lint/colour-keeps-its-meaning.test.ts`
Expected: PASS immediately — band tokens live only in `assessments.css` and `reports.css`, and neither has a brand token. A guard that passes on the day it is written is doing its job; it exists to fail on the day somebody reaches for the wrong colour.

- [ ] **Step 3: Record the reversals**

Each document is edited where it stands, with the date and the reason. Never delete a rule silently.

`CLAUDE.md` line 34 becomes:

```
- Hue is reserved for EEG band data and three status states. The inherited McWellness violet IS the accent, decided by the owner on 2026-09-08 (docs/SPEC/coloured-shell.md); it is `--brand` and it never enters a chart.
```

`PRODUCT.md` Brand Commitments: replace "It disagrees with the inherited violet accent on one point; the visual-world step must settle that with the owner. Recorded here, not resolved here." with the decision, its date, and a pointer to the spec.

`DESIGN.md` sections at 213, 254 and 431: the Silent Chrome Rule becomes the rule it now is — chrome carries the practice's violet; hue inside a figure is still only band data and status. Say what changed and when.

`docs/DESIGN-BRIEF.md`: same treatment, following the precedent of `responsive-console.md` section 6, which rewrote the brief when the operator reversed "no collapse toggle" on 7 September 2026.

`docs/SPEC/responsive-console.md`: section 3 decision 1 and section 5 (the phone's zoomed-out desk) and section 3 decision 3 and section 7 (the 1600px cap) are marked as superseded by this piece, with the date, rather than deleted. The rest of that spec still stands and is still the reference for the tiers.

- [ ] **Step 4: Run everything, twice over**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/lint/colour-keeps-its-meaning.test.ts CLAUDE.md PRODUCT.md DESIGN.md docs/
git commit -m "feat(shell): colour keeps its meaning, and the reversals are written down"
```

---

## Self-review

**Spec coverage.** Section 4 → Task 1. 4.1 and 4.3 → Task 1's test. 4.2 → Task 2. Section 5 → Task 2. Section 6 → Task 3, and Task 7 for the dark plate. Section 7 → Tasks 4 and 5. Section 8 → Task 6. Section 9 → Task 6. Section 10 → Task 7. Section 11 → Task 8. Section 12: guard 1 and 4 → Task 8; guard 2 → Task 1; guard 3 → Task 4. Section 13 → the change request, already committed. Section 14 is a list of things not to do and needs no task.

**Names, checked across tasks.** `railMode`, `tierOf`, `closesOnChoice`, `readPinned`, `writePinned`, `PIN_KEY`, `Tier`, `RailMode` are defined in Task 4 and used in Task 5 under those exact names. `--brand`, `--brand-deep`, `--brand-lift`, `--brand-pale`, `--brand-wash`, `--brand-magenta` are defined in Task 1 and used in Tasks 2, 3, 5 and 7 under those exact names. `data-rail-mode` takes the three values `railMode` returns.

**One thing the plan leaves to judgement, deliberately.** Task 6 step 4 walks eight screens at 390px and says to fix what it finds. What it will find cannot be written down before it is looked at; what can be, and is, is the list of screens, the three behaviours that already cover most of it, and the rule that the fix goes in the stylesheet that owns the screen.
