import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import {
  canOpenAudit,
  canOpenBilling,
  canOpenBooks,
  canOpenEnquiries,
  canOpenKit,
  canOpenPortalAccess,
  canOpenSchedule,
  canOpenToday,
  settingsHomeFor,
} from './adminAccess';
import type { Actor } from './auth/AuthContext';
import { useAuth } from './auth/AuthContext';
import { ADMIN_SECTIONS, Rail, type RailSection } from './components/Rail';
import {
  closesOnChoice,
  railMode,
  readPinned,
  readRail,
  tierOf,
  writePinned,
  writeRail,
} from './railState';
import { describeRoles } from './routing';

/** The browser's own store, where there is one; a test environment may have none. */
function store(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/**
 * The sections this actor may open, in `ADMIN_SECTIONS`' own order. Reads
 * the same `canOpenBilling`/`canOpenSchedule`/`settingsHomeFor` rules the routes enforce
 * (adminAccess.ts), so the rail never shows a link a route would bounce
 * the person straight back out of — a finance account sees Billing but not
 * Schedule, and only someone who treats sees Today. `clients` is
 * unconditional, having no per-role gate of its own yet.
 *
 * **Settings is the one entry whose destination depends on who is reading.**
 * Two screens sit under it with different audiences — Practice is the owner's
 * and an admin's, Practitioners is theirs and every practitioner's — so the
 * entry is shown to anyone who may open either and points at the first one
 * they may actually open. `ADMIN_SECTIONS`' own `to` is therefore not the whole
 * answer for that row, and it is overridden here, where the actor is already in
 * hand, rather than by making the rail itself role-aware. Until the fix round
 * of 2026-09-08 the entry was gated on `practice.settings.write` alone, so the
 * screen a practitioner records their own home base on had no door at all and
 * could only be reached by typing its address (the review of pull request 126,
 * finding B1).
 */
function visibleSections(actor: Actor, now: Date): readonly RailSection[] {
  const settingsHome = settingsHomeFor(actor, now);
  return ADMIN_SECTIONS.filter((section) => {
    if (section.key === 'billing') return canOpenBilling(actor, now);
    if (section.key === 'books') return canOpenBooks(actor, now);
    if (section.key === 'schedule') return canOpenSchedule(actor, now);
    if (section.key === 'today') return canOpenToday(actor);
    if (section.key === 'settings') return settingsHome !== null;
    if (section.key === 'portal') return canOpenPortalAccess(actor, now);
    if (section.key === 'kit') return canOpenKit(actor, now);
    if (section.key === 'audit') return canOpenAudit(actor, now);
    if (section.key === 'enquiries') return canOpenEnquiries(actor, now);
    return true;
  }).map((section) =>
    section.key === 'settings' && settingsHome ? { ...section, to: settingsHome } : section,
  );
}

/** The ledger: rail on the inline start, content beside it. */
export function AdminLayout({ actorName }: { actorName: string }) {
  const { session, signOut } = useAuth();
  // Open on a desk, closed to icons on anything smaller, and whatever this
  // person last chose beats both (docs/SPEC/responsive-console.md section 6).
  const [railOpen, setRailOpen] = useState(() => readRail(store(), window.innerWidth));
  // Whether the rail is held open across navigation (docs/SPEC/coloured-shell.md
  // section 7). A second remembered fact, not a second state of the first.
  const [pinned, setPinned] = useState(() => readPinned(store()));
  // The tier follows the window, because a person rotates a tablet and drags a
  // laptop's window narrow, and the rail must answer both without a reload.
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const tier = tierOf(width);
  const mode = railMode(tier, railOpen, pinned);
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
  // Choosing a section clears the view where the rail was covering it: one
  // press goes and puts the rail away, rather than leaving the page behind it.
  const chooseSection = () => {
    if (closesOnChoice(tier, pinned)) {
      setRailOpen(false);
      writeRail(store(), false);
    }
  };
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  const sections =
    session.status === 'signed-in' ? visibleSections(session.actor, new Date()) : ADMIN_SECTIONS;
  return (
    // data-rail stays: shell.css and tests/lint/layout-tokens.test.ts both read
    // it, and it still says whether the labels are showing. data-rail-mode says
    // how the rail is standing, which is the thing the three tiers differ on.
    <div className="admin" data-rail={railOpen ? 'open' : 'closed'} data-rail-mode={mode}>
      <Rail
        person={{ name: actorName, roles }}
        sections={sections}
        onSignOut={() => void signOut()}
        open={railOpen}
        onToggle={toggleRail}
        covering={mode === 'overlay'}
        pinned={pinned}
        onTogglePin={tier === 'desk' ? undefined : togglePin}
        onChoose={chooseSection}
      />
      {mode === 'overlay' ? (
        // A press anywhere on the page closes the rail. It is not announced and
        // not reachable by keyboard: Escape and the toggle are the announced
        // ways out, and useDrawer has already made everything behind inert, so
        // a second stop in the tab order would be noise.
        <button
          type="button"
          className="admin__scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={toggleRail}
        />
      ) : null}
      <main className="admin__main">
        {/*
         * The screens arrive one at a time rather than in the file everybody
         * downloads at sign-in (`app/shell/App.tsx`), so the wait belongs
         * here, inside the chrome: the rail and the header stay where they
         * are and only this panel is briefly empty. Nothing is drawn in that
         * gap deliberately — every screen already says what it is loading
         * once it has arrived, and a second message in front of it would say
         * the same thing twice.
         */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
