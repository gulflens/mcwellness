import { Outlet } from 'react-router';
import { useAuth } from './auth/AuthContext';
import { Rail } from './components/Rail';
import { describeRoles } from './routing';

/** The ledger: rail on the inline start, content beside it. */
export function AdminLayout({ actorName }: { actorName: string }) {
  const { session, signOut } = useAuth();
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  return (
    <div className="admin">
      <Rail person={{ name: actorName, roles }} onSignOut={() => void signOut()} />
      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  );
}
