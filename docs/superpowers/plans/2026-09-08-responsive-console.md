# The console on any screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin console three layout tiers, a sidebar that scrolls on its own and closes to a strip of icons, and a desk-width layout on a phone so the whole console is shown zoomed out rather than crammed.

**Architecture:** One breakpoint at 720px becomes two mobile-first boundaries, 768px and 1200px, set in `app/shell/shell.css` and reached everywhere else through tokens in `app/shell/tokens.css`. A new shell module rewrites the document's viewport meta element when the route area changes, so an `/admin` route on a small-screened device lays out at 1024px and the browser scales it to fit. The rail gains a persisted open-or-closed state and its own scrolling section list. Tables pin their first two columns unconditionally instead of only below 720px.

**Tech Stack:** TypeScript, React 19, react-router 8, Vite 8, Vitest with jsdom, plain CSS with custom properties and logical properties only.

**Spec:** `docs/SPEC/responsive-console.md`

## Global Constraints

- Colour comes only from `app/shell/tokens.css`. No hex literal may appear in any file this plan touches. The ESLint rule `mcwellness/no-hex-colour` fails the build on one.
- Logical properties only. No `left`, `right`, `margin-left`, `text-align: left`. The layout mirrors for Arabic without a second stylesheet.
- Every size, spacing step, radius and duration is a token. No component writes a pixel value of its own.
- Rows, inputs, buttons and rail items are 44px tall (`var(--row)`). The sign-out control and the drawer's close control are 48px (`var(--tap)`).
- No ALL-CAPS labels, no arrows appended to button text, no middle-dot-joined metadata, no single-word colour accents in headings.
- The console and the practitioner app are English only. Arabic belongs to client-facing surfaces.
- `app/therapist/**` is not touched by any task in this plan.
- `pnpm verify` must pass before any task is called done. It runs `format:check`, `lint`, `typecheck`, the secrets scan, the migrations audit and `test`.
- Conventional commit messages, one purpose per commit.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `app/shell/viewport.ts` | The pure map from route area and screen width to a viewport `content` string, and the effect that applies it to the document |
| `app/shell/viewport.test.ts` | Proves the map, including that zooming is never disabled |
| `app/shell/railState.ts` | The rail's open-or-closed state: the tier default, the remembered choice, and a storage that may throw |
| `app/shell/railState.test.ts` | Proves the default, the remembered choice and the storage fallback |
| `tests/lint/one-set-of-breakpoints.test.ts` | Guard: only `app/shell/shell.css` and three named files may declare a width media query |
| `tests/lint/layout-tokens.test.ts` | Guard: the tier boundaries, the content column's `minmax(0, 1fr)`, and no zoom-disabling declaration |

**Modified**

| File | Change |
|---|---|
| `app/shell/tokens.css` | `--rail-open`, `--rail-closed`, a fluid `--drawer`, `--content-max` raised to 1600px |
| `app/shell/shell.css` | The 720px blocks replaced by two mobile-first tiers; the rail's own scroll; the closed rail; unconditional column pinning |
| `app/shell/components/Rail.tsx` | The toggle, `aria-expanded`, accessible names that survive the closed state |
| `app/shell/components/Rail.test.tsx` | Cases for the toggle and the closed state |
| `app/shell/AdminLayout.tsx` | Holds the rail's state, sets the layout's data attribute |
| `app/shell/components/Icons.tsx` | One icon for the toggle |
| `app/shell/components/Table.tsx` | Carries the pinning class |
| `app/shell/App.tsx` | Calls the viewport effect |
| `app/admin/schedule/schedule.css` | The 640px rule becomes the compact tier; the 1100px rule stays with a comment |
| `app/admin/settings/settings.css` | The 40rem rule becomes the tablet tier |
| `app/admin/audit/audit.css` | The 48rem rule becomes the tablet tier |
| `tests/scheduling/WeekPage.test.tsx` | Reads the tier instead of a bare `max-width` |
| `DESIGN.md`, `docs/DESIGN-BRIEF.md` | The breakpoint paragraph and the "no collapse toggle" line |

**Untouched:** everything under `app/therapist/`, `app/client/portal.css`, `app/shell/pages/SignInPage.tsx`, every API route, every migration.

---

### Task 1: The viewport module

Delivers the phone treatment. Pure function first, then the effect that applies it.

**Files:**
- Create: `app/shell/viewport.ts`
- Create: `app/shell/viewport.test.ts`
- Modify: `app/shell/App.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `viewportContent(area: RouteArea, screenWidth: number): string` and `useViewport(pathname: string): void`, plus `type RouteArea = 'console' | 'other'` and `areaOf(pathname: string): RouteArea`. Task 7's guard test reads no exports from here.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { areaOf, DESK_WIDTH, viewportContent } from './viewport';

const DEVICE = 'width=device-width, initial-scale=1';

describe('areaOf', () => {
  it('calls only the admin console the console', () => {
    expect(areaOf('/admin/clients')).toBe('console');
    expect(areaOf('/admin')).toBe('console');
    expect(areaOf('/today')).toBe('other');
    expect(areaOf('/portal/home')).toBe('other');
    expect(areaOf('/sign-in')).toBe('other');
  });
});

describe('viewportContent', () => {
  it('lays the console out at a desk width on a small-screened device', () => {
    expect(viewportContent('console', 390)).toBe(`width=${DESK_WIDTH}`);
    expect(viewportContent('console', 767)).toBe(`width=${DESK_WIDTH}`);
  });

  it('leaves the console at the device width on anything larger', () => {
    expect(viewportContent('console', 768)).toBe(DEVICE);
    expect(viewportContent('console', 1440)).toBe(DEVICE);
  });

  it('never gives another area the desk width', () => {
    for (const width of [320, 390, 768, 1440]) {
      expect(viewportContent('other', width)).toBe(DEVICE);
    }
  });

  it('never takes zooming away', () => {
    const every = [
      viewportContent('console', 390),
      viewportContent('console', 1440),
      viewportContent('other', 390),
    ];
    for (const content of every) {
      expect(content).not.toContain('user-scalable');
      expect(content).not.toContain('maximum-scale');
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run app/shell/viewport.test.ts`
Expected: FAIL, `Failed to resolve import "./viewport"`.

- [ ] **Step 3: Write the module**

```ts
import { useEffect } from 'react';

/**
 * The console on a small screen is shown whole and zoomed out rather than
 * squeezed (docs/SPEC/responsive-console.md section 5). The person pinches to
 * zoom and drags to pan; nothing reflows and nothing is hidden.
 *
 * The practitioner app, the household's portal and the sign-in page keep the
 * device's own width: each is designed for a phone and must stay readable
 * without zooming.
 */
export const DESK_WIDTH = 1024;

/** Below this, a device is too narrow to show the console at its own size. */
export const SMALL_SCREEN = 768;

const DEVICE = 'width=device-width, initial-scale=1';

export type RouteArea = 'console' | 'other';

export function areaOf(pathname: string): RouteArea {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'console' : 'other';
}

/**
 * With a width and no initial scale the browser picks the scale that fits the
 * layout to the screen, which is exactly the zoomed-out page we want. Neither
 * `user-scalable=no` nor `maximum-scale` is ever written: taking zoom away
 * from someone who needs it is never the answer.
 */
export function viewportContent(area: RouteArea, screenWidth: number): string {
  return area === 'console' && screenWidth < SMALL_SCREEN ? `width=${DESK_WIDTH}` : DEVICE;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run app/shell/viewport.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the effect and its test**

Append to `app/shell/viewport.ts`:

```ts
/**
 * Applies the answer to the document's own viewport element.
 *
 * The width is read from `screen`, never from `window.innerWidth`: setting
 * this element changes `innerWidth`, so a condition built on it would flip
 * itself back and forth on every render. `screen.width` is the device and
 * does not move.
 */
export function useViewport(pathname: string): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute('content', viewportContent(areaOf(pathname), window.screen.width));
  }, [pathname]);
}
```

Append to `app/shell/viewport.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { useViewport } from './viewport';

describe('useViewport', () => {
  it('writes the desk width onto the document for the console on a phone', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    Object.defineProperty(window.screen, 'width', { value: 390, configurable: true });
    renderHook(() => useViewport('/admin/clients'));
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      `width=${DESK_WIDTH}`,
    );
  });

  it('puts the device width back when the person leaves the console', () => {
    document.head.innerHTML = `<meta name="viewport" content="width=${DESK_WIDTH}">`;
    Object.defineProperty(window.screen, 'width', { value: 390, configurable: true });
    renderHook(() => useViewport('/today'));
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(DEVICE);
  });
});
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm vitest run app/shell/viewport.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Call it from the app**

In `app/shell/App.tsx`, add `useLocation` if it is not already imported, import `useViewport` from `./viewport`, and call it at the top of `App`:

```tsx
export function App() {
  const { pathname } = useLocation();
  useViewport(pathname);
  return (
    <Routes>
```

- [ ] **Step 8: Run the shell's tests and the type check**

Run: `pnpm vitest run app/shell && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add app/shell/viewport.ts app/shell/viewport.test.ts app/shell/App.tsx
git commit -m "feat(shell): the console lays out at a desk width on a small screen"
```

---

### Task 2: The rail's remembered state

**Files:**
- Create: `app/shell/railState.ts`
- Create: `app/shell/railState.test.ts`

**Interfaces:**
- Consumes: `SMALL_SCREEN` and `DESK_WIDTH` are not needed here; this module has its own boundary constant.
- Produces: `railOpenByDefault(viewportWidth: number): boolean`, `readRail(store: Storage | undefined, viewportWidth: number): boolean`, `writeRail(store: Storage | undefined, open: boolean): void`, and `RAIL_KEY = 'mcwellness.rail'`. Task 3 consumes all four.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RAIL_KEY, railOpenByDefault, readRail, writeRail } from './railState';

/** A storage that refuses everything, as a private window's can. */
const refusing: Storage = {
  get length() {
    return 0;
  },
  clear() {
    throw new Error('no');
  },
  getItem() {
    throw new Error('no');
  },
  key() {
    throw new Error('no');
  },
  removeItem() {
    throw new Error('no');
  },
  setItem() {
    throw new Error('no');
  },
};

function emptyStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('railOpenByDefault', () => {
  it('opens on a desk and closes on anything smaller', () => {
    expect(railOpenByDefault(1200)).toBe(true);
    expect(railOpenByDefault(1440)).toBe(true);
    expect(railOpenByDefault(1199)).toBe(false);
    expect(railOpenByDefault(820)).toBe(false);
    expect(railOpenByDefault(390)).toBe(false);
  });
});

describe('readRail', () => {
  it('takes the tier default when nothing is remembered', () => {
    expect(readRail(emptyStore(), 1440)).toBe(true);
    expect(readRail(emptyStore(), 820)).toBe(false);
  });

  it("lets the person's own choice beat the default at any size", () => {
    const store = emptyStore();
    store.setItem(RAIL_KEY, 'closed');
    expect(readRail(store, 1440)).toBe(false);
    store.setItem(RAIL_KEY, 'open');
    expect(readRail(store, 390)).toBe(true);
  });

  it('ignores a value it does not recognise', () => {
    const store = emptyStore();
    store.setItem(RAIL_KEY, 'sideways');
    expect(readRail(store, 1440)).toBe(true);
  });

  it('falls back to the default when storage refuses or is absent', () => {
    expect(readRail(refusing, 1440)).toBe(true);
    expect(readRail(refusing, 820)).toBe(false);
    expect(readRail(undefined, 820)).toBe(false);
  });
});

describe('writeRail', () => {
  it('remembers the choice', () => {
    const store = emptyStore();
    writeRail(store, false);
    expect(store.getItem(RAIL_KEY)).toBe('closed');
    writeRail(store, true);
    expect(store.getItem(RAIL_KEY)).toBe('open');
  });

  it('says nothing when storage refuses or is absent', () => {
    expect(() => writeRail(refusing, true)).not.toThrow();
    expect(() => writeRail(undefined, true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run app/shell/railState.test.ts`
Expected: FAIL, `Failed to resolve import "./railState"`.

- [ ] **Step 3: Write the module**

```ts
/**
 * Whether the console's rail is open, remembered on this device
 * (docs/SPEC/responsive-console.md section 6).
 *
 * The tier decides the first answer: open where there is room for labels,
 * closed to a strip of icons where there is not. The person's own choice then
 * beats the tier at every size until they change it again. Nothing personal is
 * stored; the key holds one word.
 */
export const RAIL_KEY = 'mcwellness.rail';

/** The desk tier's boundary, the same 1200px `shell.css` uses. */
const DESK = 1200;

export function railOpenByDefault(viewportWidth: number): boolean {
  return viewportWidth >= DESK;
}

export function readRail(store: Storage | undefined, viewportWidth: number): boolean {
  const fallback = railOpenByDefault(viewportWidth);
  if (!store) return fallback;
  try {
    const stored = store.getItem(RAIL_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
    return fallback;
  } catch {
    // A private window may refuse storage. The console still works.
    return fallback;
  }
}

export function writeRail(store: Storage | undefined, open: boolean): void {
  if (!store) return;
  try {
    store.setItem(RAIL_KEY, open ? 'open' : 'closed');
  } catch {
    // Nothing to do and nothing to tell the person: the choice simply lasts
    // for this visit rather than the next one.
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run app/shell/railState.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/shell/railState.ts app/shell/railState.test.ts
git commit -m "feat(shell): the rail's open state, defaulted by tier and remembered per device"
```

---

### Task 3: The rail opens and closes

**Files:**
- Modify: `app/shell/components/Icons.tsx`
- Modify: `app/shell/components/Rail.tsx`
- Modify: `app/shell/components/Rail.test.tsx`
- Modify: `app/shell/AdminLayout.tsx`

**Interfaces:**
- Consumes: `readRail`, `writeRail` from `app/shell/railState.ts` (Task 2).
- Produces: `Rail` gains two props, `open: boolean` and `onToggle: () => void`. `AdminLayout` renders `<div className="admin" data-rail={open ? 'open' : 'closed'}>`, which is the hook Task 4's CSS uses.

- [ ] **Step 1: Add the icon**

In `app/shell/components/Icons.tsx`, beside the others:

```tsx
/** Two uprights and a bar: the rail, opened or put away. */
export function RailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 4.5h14v11H3z" />
      <path d="M8 4.5v11" />
    </Icon>
  );
}
```

- [ ] **Step 2: Write the failing tests**

Add to `app/shell/components/Rail.test.tsx`, inside the existing `describe('Rail', ...)`:

```tsx
  it('offers a control that says whether the sections are shown', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={onToggle}
        />
      </MemoryRouter>,
    );
    const control = screen.getByRole('button', { name: 'Sections' });
    expect(control).toHaveProperty('ariaExpanded', 'true');
    fireEvent.click(control);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps every section reachable by name when it is closed', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open={false}
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Sections' })).toHaveProperty(
      'ariaExpanded',
      'false',
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Billing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm vitest run app/shell/components/Rail.test.tsx`
Expected: FAIL, no button named "Sections".

- [ ] **Step 4: Change the component**

In `app/shell/components/Rail.tsx`, import `RailIcon` alongside the other icons, add the two props, and render the control. The section labels stay in the markup at every state, so their accessible names never depend on the CSS; Task 4 hides them visually when the rail is closed.

```tsx
export function Rail({
  sections = ADMIN_SECTIONS,
  person,
  onSignOut,
  open,
  onToggle,
}: {
  sections?: readonly RailSection[];
  person: { name: string; roles: string };
  onSignOut: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail__head">
        <div className="rail__mark">McWellness</div>
        <button
          type="button"
          className="rail__toggle"
          onClick={onToggle}
          aria-expanded={open}
          title="Sections"
        >
          <RailIcon />
          <span className="visually-hidden">Sections</span>
        </button>
      </div>
```

The rest of the component is unchanged. Each link keeps its label element and gains a `title` so the closed rail names itself on hover:

```tsx
              <NavLink
                to={section.to}
                title={section.label}
                className={({ isActive }) =>
                  isActive ? 'rail__item rail__item--active' : 'rail__item'
                }
              >
                {section.icon}
                <span className="rail__label">{section.label}</span>
              </NavLink>
```

Apply the same `rail__label` class to the arriving section's label and its "Arriving" marker, and to the person's name and roles.

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm vitest run app/shell/components/Rail.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Hold the state in the layout**

In `app/shell/AdminLayout.tsx`:

```tsx
import { useState } from 'react';
import { readRail, writeRail } from './railState';

// inside AdminLayout, above the return
const [open, setOpen] = useState(() =>
  readRail(typeof localStorage === 'undefined' ? undefined : localStorage, window.innerWidth),
);
const toggle = () => {
  setOpen((was) => {
    const next = !was;
    writeRail(typeof localStorage === 'undefined' ? undefined : localStorage, next);
    return next;
  });
};

return (
  <div className="admin" data-rail={open ? 'open' : 'closed'}>
    <Rail
      person={{ name: actorName, roles }}
      sections={sections}
      onSignOut={() => void signOut()}
      open={open}
      onToggle={toggle}
    />
```

- [ ] **Step 7: Run the shell's tests and the type check**

Run: `pnpm vitest run app/shell && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add app/shell/components/Icons.tsx app/shell/components/Rail.tsx app/shell/components/Rail.test.tsx app/shell/AdminLayout.tsx
git commit -m "feat(shell): the rail opens and closes, and keeps its names when closed"
```

---

### Task 4: The three tiers

The largest task. `shell.css`'s layout section is rewritten mobile-first: the base rules are the compact tier, and two `min-width` queries add the tablet and desk tiers. The three `@media (max-width: 720px)` blocks go.

**Files:**
- Modify: `app/shell/tokens.css`
- Modify: `app/shell/shell.css`

**Interfaces:**
- Consumes: `data-rail="open" | "closed"` on `.admin` (Task 3).
- Produces: the custom properties `--rail-open`, `--rail-closed`, `--rail`, and the two boundaries 768px and 1200px, which Task 6's stylesheets and Task 7's guard tests both refer to.

- [ ] **Step 1: Add the tokens**

In `app/shell/tokens.css`, replace the `--rail: 220px;` and `--drawer: 480px;` lines and the `--content-max` line inside `:root`:

```css
  /* The rail at its two sizes. The tier and the person's choice pick one;
     shell.css sets --rail from data-rail. */
  --rail-open: 220px;
  --rail-closed: 64px;
  --rail: var(--rail-open);

  /* Never much more than half the screen, so the ledger stays readable
     beside it (docs/SPEC/responsive-console.md section 7). */
  --drawer: clamp(320px, 55vw, 480px);

  /* Tables and the schedule may fill a wide display; prose keeps --measure. */
  --content-max: 1600px;
```

- [ ] **Step 2: Rewrite the layout, compact first**

In `app/shell/shell.css`, replace the `.admin`, `.admin__main` and `.rail` rules near the top with the compact tier, and delete all three `@media (max-width: 720px)` blocks. The pinned-column rules from the last of those blocks move to Task 5; the rest of their content becomes the base.

```css
/* The ledger: rail and content. Compact first — the base rules are the
   smallest screen, and the two tiers below add to them
   (docs/SPEC/responsive-console.md section 4). */
.admin {
  display: grid;
  /* minmax(0, 1fr): a wide table scrolls inside its own container instead of
     widening the page. The page body never scrolls sideways. */
  grid-template-columns: var(--rail) minmax(0, 1fr);
  min-block-size: 100dvh;
}

.admin[data-rail='closed'] {
  --rail: var(--rail-closed);
}

.admin__main {
  min-inline-size: 0;
  padding: var(--s-4) var(--s-4) var(--s-12);
  max-inline-size: var(--content-max);
}

.rail {
  position: sticky;
  inset-block-start: 0;
  block-size: 100dvh;
  display: flex;
  flex-direction: column;
  padding: var(--s-4) var(--s-2);
  border-inline-end: var(--hairline) solid var(--rule);
  background: var(--paper);
  overflow: hidden;
}

/* The wordmark and the control that puts the rail away, on one line. */
.rail__head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-block-end: var(--s-6);
}

.rail__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  inline-size: var(--tap);
  min-block-size: var(--tap);
  margin-inline-start: auto;
  padding: 0;
  border: 0;
  border-radius: var(--r-2);
  background: none;
  color: var(--ink-2);
  cursor: pointer;
}

.rail__toggle:hover {
  color: var(--ink);
}

/* The sections scroll on their own, so the person's name and the way out can
   never be pushed off the screen by a long list. */
.rail__list {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
}

.rail__person {
  flex: none;
  margin-block-start: var(--s-4);
  padding: var(--s-4) var(--s-3) 0;
  border-block-start: var(--hairline) solid var(--rule);
}

/* Closed: the icons stay, the words stand down. Every link keeps its
   accessible name in the markup, so nothing is lost to a screen reader. */
.admin[data-rail='closed'] .rail__label,
.admin[data-rail='closed'] .rail__mark,
.admin[data-rail='closed'] .rail__later {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.admin[data-rail='closed'] .rail__item,
.admin[data-rail='closed'] .rail__toggle {
  justify-content: center;
  padding-inline: 0;
}

.admin[data-rail='closed'] .rail__toggle {
  margin-inline-start: 0;
}

.admin[data-rail='closed'] .rail__person {
  padding-inline: 0;
  text-align: center;
}

/* The tablet tier. */
@media (min-width: 768px) {
  .admin__main {
    padding: var(--s-6) var(--s-6) var(--s-16);
  }

  .rail {
    padding: var(--s-6) var(--s-3);
  }
}

/* The desk tier. */
@media (min-width: 1200px) {
  .admin__main {
    padding: var(--s-8) var(--s-8) var(--s-16);
  }

  .rail {
    padding: var(--s-6) var(--s-4);
  }
}
```

- [ ] **Step 3: Keep the drawer's narrow case**

Replace the drawer's old `@media (max-width: 720px)` rule with the compact-first equivalent, placed with the other drawer rules:

```css
/* Below the tablet tier the drawer is the whole width and drops its edge
   hairline; above it the clamp in tokens.css decides. */
@media (max-width: 767px) {
  .drawer {
    inline-size: 100%;
    border-inline-start: 0;
  }
}
```

- [ ] **Step 4: Let the toolbar breathe on a narrow screen**

Replace the old toolbar rule from the deleted block:

```css
@media (max-width: 767px) {
  .toolbar .field {
    flex: 1 1 100%;
    min-inline-size: 0;
  }
}
```

- [ ] **Step 5: Check the console in a browser**

Start the app with `pnpm dev`, sign in as a seeded person, and open `/admin/clients` at 390, 820, 1024 and 1440 pixels wide. Expected at each: the page body does not scroll sideways, the rail is closed below 1200 and open at 1440, the toggle changes it, and the sections scroll inside the rail when the window is short.

- [ ] **Step 6: Run the suite and the formatter**

Run: `pnpm format && pnpm vitest run && pnpm lint`
Expected: PASS. `tests/scheduling/WeekPage.test.tsx` may fail here; Task 6 fixes it. If it does, note it and carry on.

- [ ] **Step 7: Commit**

```bash
git add app/shell/tokens.css app/shell/shell.css
git commit -m "feat(shell): three layout tiers in place of the single 720px breakpoint"
```

---

### Task 5: Tables pin their first columns at every size

**Files:**
- Modify: `app/shell/components/Table.tsx`
- Modify: `app/shell/shell.css`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the class `ledger--pinned` on the table element, which the CSS keys on.

- [ ] **Step 1: Carry the class**

In `app/shell/components/Table.tsx`, change the table element:

```tsx
      <table className="ledger ledger--pinned">
```

- [ ] **Step 2: Move the pinning rules out of the deleted media query**

In `app/shell/shell.css`, add, unconditional:

```css
/* The record and the name stay put while the rest of the row scrolls
   (docs/SPEC/responsive-console.md section 8). Unconditional: a sticky column
   inside a container it already fits has nothing to stick to and no visible
   effect, so nothing needs to measure the table against the viewport. */
.ledger--pinned th:nth-child(1),
.ledger--pinned td:nth-child(1) {
  position: sticky;
  inset-inline-start: 0;
  background: var(--paper);
  inline-size: 7.5rem;
  min-inline-size: 7.5rem;
}

.ledger--pinned th:nth-child(2),
.ledger--pinned td:nth-child(2) {
  position: sticky;
  inset-inline-start: 7.5rem;
  background: var(--paper);
  box-shadow: inset calc(-1 * var(--hairline)) 0 0 var(--rule);
}

.ledger--pinned th:nth-child(1) {
  z-index: 1;
}
```

- [ ] **Step 3: Check the widest table in a browser**

Open `/admin/kit` at 820 pixels wide. Expected: the first two columns stay while the rest scrolls sideways inside the table, and the page body does not move.

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run app/shell && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/shell/components/Table.tsx app/shell/shell.css
git commit -m "feat(shell): a table pins its first two columns whenever it is too wide"
```

---

### Task 6: The module stylesheets join the tiers

**Files:**
- Modify: `app/admin/schedule/schedule.css`
- Modify: `app/admin/settings/settings.css`
- Modify: `app/admin/audit/audit.css`
- Modify: `tests/scheduling/WeekPage.test.tsx`

**Interfaces:**
- Consumes: the two boundaries from Task 4.
- Produces: a tree in which only four stylesheets declare a width query, which Task 7's guard asserts.

- [ ] **Step 1: Change the week's fold**

In `app/admin/schedule/schedule.css`, change `@media (max-width: 640px)` to `@media (max-width: 767px)` and update the comment above it to name the compact tier rather than a phone. Leave the `@media (max-width: 1100px)` rule alone and add a line to its comment:

```css
/* Kept deliberately: this asks whether seven columns still fit their content,
   which is a different question from the tier the screen is in
   (docs/SPEC/responsive-console.md section 9). */
```

- [ ] **Step 2: Change the settings and audit folds**

In `app/admin/settings/settings.css` change `@media (width < 40rem)` to `@media (max-width: 767px)`.
In `app/admin/audit/audit.css` change `@media (width < 48rem)` to `@media (max-width: 767px)`.

- [ ] **Step 3: Update the week's test**

In `tests/scheduling/WeekPage.test.tsx` line 97, the regular expression reads the stylesheet for the fold. Change the expected width to 767 and add a comment naming the tier:

```ts
    // The compact tier, docs/SPEC/responsive-console.md section 4.
    const folds = [...css.matchAll(/@media \(max-width: (767)px\)\s*\{\s*\.week\s*\{/g)];
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/scheduling/WeekPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/schedule/schedule.css app/admin/settings/settings.css app/admin/audit/audit.css tests/scheduling/WeekPage.test.tsx
git commit -m "refactor(admin): the module folds join the shell's tiers"
```

---

### Task 7: The guards

Two tests that keep the system from drifting back.

**Files:**
- Create: `tests/lint/one-set-of-breakpoints.test.ts`
- Create: `tests/lint/layout-tokens.test.ts`

**Interfaces:**
- Consumes: the finished state of Tasks 4, 5 and 6.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the breakpoint guard**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One set of breakpoints, in one file (docs/SPEC/responsive-console.md
 * section 9). A screen that needs a size of its own is almost always a screen
 * that should be using a tier; the three exceptions each answer a question the
 * tiers do not, and each says so in a comment beside the rule.
 */
const ALLOWED = new Set([
  'app/shell/shell.css',
  // Seven columns against their content, not the screen against a tier.
  'app/admin/schedule/schedule.css',
  // A taller screen may show more of a consent at once.
  'app/admin/clients/clients.css',
  // The household's portal keeps its own phone layout by decision.
  'app/client/portal.css',
]);

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) stylesheets(path, found);
    else if (entry.endsWith('.css')) found.push(path);
  }
  return found;
}

describe('one set of breakpoints', () => {
  it('is declared in the shell and the three files that argue for their own', () => {
    const offenders = stylesheets('app')
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => /@media[^{]*\b(?:min|max)-width\b/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('uses 768 and 1200 as the only tier boundaries in the shell', () => {
    const css = readFileSync('app/shell/shell.css', 'utf8');
    const widths = [...css.matchAll(/@media[^{]*?\b(?:min|max)-width:\s*(\d+)px/g)].map(
      (match) => Number(match[1]),
    );
    expect(new Set(widths)).toEqual(new Set([767, 768, 1200]));
  });
});
```

- [ ] **Step 2: Write the token guard**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The rules the layout cannot lose without the console breaking somewhere
 * nobody is looking (docs/SPEC/responsive-console.md section 10).
 */
describe('layout tokens', () => {
  const shell = readFileSync('app/shell/shell.css', 'utf8');
  const tokens = readFileSync('app/shell/tokens.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  it('keeps the content column able to shrink, so a wide table never widens the page', () => {
    expect(shell).toContain('grid-template-columns: var(--rail) minmax(0, 1fr)');
  });

  it('names both rail widths and lets the layout choose between them', () => {
    expect(tokens).toContain('--rail-open: 220px');
    expect(tokens).toContain('--rail-closed: 64px');
    expect(shell).toContain("[data-rail='closed']");
  });

  it('never takes zooming away from anybody', () => {
    for (const source of [shell, tokens, html]) {
      expect(source).not.toContain('user-scalable');
      expect(source).not.toContain('maximum-scale');
    }
  });
});
```

- [ ] **Step 3: Run them and watch them pass**

Run: `pnpm vitest run tests/lint`
Expected: PASS. If the breakpoint guard names an offender, that stylesheet was missed by Task 6; fix the stylesheet rather than widening the allow list.

- [ ] **Step 4: Commit**

```bash
git add tests/lint/one-set-of-breakpoints.test.ts tests/lint/layout-tokens.test.ts
git commit -m "test(lint): guard the one set of breakpoints and the layout's tokens"
```

---

### Task 8: The documents agree with the code

**Files:**
- Modify: `DESIGN.md`
- Modify: `docs/DESIGN-BRIEF.md`
- Modify: `docs/HANDOVER.md`

**Interfaces:**
- Consumes: the finished state of every earlier task.
- Produces: nothing.

- [ ] **Step 1: Replace the breakpoint paragraph**

`DESIGN.md` line 302 begins "There is one breakpoint, at 720px." Replace the whole paragraph with the three tiers, the rail's two states and its own scrolling, the unconditional column pinning, and the console's desk width on a phone. Keep the closing sentence, "The page body never scrolls sideways," because it is still true and still tested.

- [ ] **Step 2: Reverse the brief's line, and say so**

`docs/DESIGN-BRIEF.md` section 6.2 reads "fixed left rail (icon + label, no collapse toggle)". Change it to describe the rail that opens and closes, and add a dated line recording the reversal:

```markdown
*Changed 7 September 2026 on the operator's instruction: the rail opens and
closes. It was pinned as having no collapse toggle; a console used on a tablet
needs the width back, and the person's choice is remembered on their device.*
```

- [ ] **Step 3: Add the piece to the hand-over**

In `docs/HANDOVER.md`, record piece nineteen: what it is, the specification and plan it came from, the four decisions of 7 September, and where it stands.

- [ ] **Step 4: Check nothing says 720 any more**

Run: `grep -rn "720px" DESIGN.md docs/DESIGN-BRIEF.md app/shell/`
Expected: no result, or only a line that is explaining the history.

- [ ] **Step 5: Run the whole gate**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md docs/DESIGN-BRIEF.md docs/HANDOVER.md
git commit -m "docs: the three tiers, the rail that closes, and the reversal it records"
```

---

## Self-Review

**Spec coverage.** Section 4's tiers are Task 4. Section 5's phone treatment is Task 1. Section 6's sidebar is Tasks 2 and 3, and its brief reversal is Task 8. Section 7's tokens are Task 4. Section 8's tables are Task 5. Section 9's module stylesheets are Task 6. Section 10's four tests are Tasks 1, 2, 3 and 7. Section 11's untouched surfaces are enforced by the file lists and by the guard's allow list. No section is without a task.

**Types.** `viewportContent`, `areaOf`, `DESK_WIDTH` and `SMALL_SCREEN` are used in Task 1 only. `readRail`, `writeRail`, `railOpenByDefault` and `RAIL_KEY` are defined in Task 2 and consumed in Task 3 with the same names and signatures. `Rail`'s two new props, `open` and `onToggle`, are declared in Task 3 and passed in the same task. `data-rail` is written in Task 3 and read in Task 4. `ledger--pinned` is written and read in Task 5.

**One number to watch.** Task 7's second test expects the shell's width queries to be exactly 767, 768 and 1200. Task 4 writes 767 twice, for the drawer and the toolbar, and 768 and 1200 for the tiers. If a later change adds a fourth, the guard fails, which is the point.
