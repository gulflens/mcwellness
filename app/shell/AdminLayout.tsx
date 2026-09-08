import { useState } from 'react';
import { Outlet } from 'react-router';
import {
  canOpenAudit,
  canOpenBilling,
  canOpenBooks,
  canOpenKit,
  canOpenPortalAccess,
  canOpenSchedule,
  canOpenToday,
  settingsHomeFor,
} from './adminAccess';
import type { Actor } from './auth/AuthContext';
import { useAuth } from './auth/AuthContext';
import { ADMIN_SECTIONS, Rail, type RailSection } from './components/Rail';
import { readRail, writeRail } from './railState';
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
 * unconditional, having no per-role gate of its own yet, and `sessions` still
 * carries no `to` at all, so it renders as "Arriving" regardless of role.
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
  const toggleRail = () => {
    setRailOpen((wasOpen) => {
      const open = !wasOpen;
      writeRail(store(), open);
      return open;
    });
  };
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  const sections =
    session.status === 'signed-in' ? visibleSections(session.actor, new Date()) : ADMIN_SECTIONS;
  return (
    <div className="admin" data-rail={railOpen ? 'open' : 'closed'}>
      <Rail
        person={{ name: actorName, roles }}
        sections={sections}
        onSignOut={() => void signOut()}
        open={railOpen}
        onToggle={toggleRail}
      />
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  );
}
