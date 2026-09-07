import { useState } from 'react';
import { Outlet } from 'react-router';
import {
  canOpenAudit,
  canOpenBilling,
  canOpenBooks,
  canOpenKit,
  canOpenPortalAccess,
  canOpenSchedule,
  canOpenSettings,
  canOpenToday,
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
 * the same `canOpenBilling`/`canOpenSchedule`/`canOpenSettings` rules the routes enforce
 * (adminAccess.ts), so the rail never shows a link a route would bounce
 * the person straight back out of — a finance account sees Billing but not
 * Schedule, and only someone who treats sees Today. `clients` is
 * unconditional, having no per-role gate of its own yet, and `sessions` still
 * carries no `to` at all, so it renders as "Arriving" regardless of role.
 */
function visibleSections(actor: Actor, now: Date): readonly RailSection[] {
  return ADMIN_SECTIONS.filter((section) => {
    if (section.key === 'billing') return canOpenBilling(actor, now);
    if (section.key === 'books') return canOpenBooks(actor, now);
    if (section.key === 'schedule') return canOpenSchedule(actor, now);
    if (section.key === 'today') return canOpenToday(actor);
    if (section.key === 'settings') return canOpenSettings(actor, now);
    if (section.key === 'portal') return canOpenPortalAccess(actor, now);
    if (section.key === 'kit') return canOpenKit(actor, now);
    if (section.key === 'audit') return canOpenAudit(actor, now);
    return true;
  });
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
