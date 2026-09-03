import { Outlet } from 'react-router';
import { canOpenBilling, canOpenSchedule, canOpenToday } from './adminAccess';
import type { Actor } from './auth/AuthContext';
import { useAuth } from './auth/AuthContext';
import { ADMIN_SECTIONS, Rail, type RailSection } from './components/Rail';
import { describeRoles } from './routing';

/**
 * The sections this actor may open, in `ADMIN_SECTIONS`' own order. Reads
 * the same `canOpenBilling`/`canOpenSchedule` rules the routes enforce
 * (adminAccess.ts), so the rail never shows a link a route would bounce
 * the person straight back out of — a finance account sees Billing but not
 * Schedule, and only someone who treats sees Today. `clients`, `sessions`
 * and `audit` are unconditional: `clients`
 * has no per-role gate of its own yet, and `sessions`/`audit` still carry
 * no `to` at all, so they render as "Arriving" regardless of role.
 */
function visibleSections(actor: Actor, now: Date): readonly RailSection[] {
  return ADMIN_SECTIONS.filter((section) => {
    if (section.key === 'billing') return canOpenBilling(actor, now);
    if (section.key === 'schedule') return canOpenSchedule(actor, now);
    if (section.key === 'today') return canOpenToday(actor);
    return true;
  });
}

/** The ledger: rail on the inline start, content beside it. */
export function AdminLayout({ actorName }: { actorName: string }) {
  const { session, signOut } = useAuth();
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  const sections =
    session.status === 'signed-in' ? visibleSections(session.actor, new Date()) : ADMIN_SECTIONS;
  return (
    <div className="admin">
      <Rail
        person={{ name: actorName, roles }}
        sections={sections}
        onSignOut={() => void signOut()}
      />
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  );
}
