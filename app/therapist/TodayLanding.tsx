import { useNavigate } from 'react-router';
import { useAuth } from '../shell/auth/AuthContext';
import { Button, Note } from '../shell/components/Controls';
import { describeRoles, homeFor } from '../shell/routing';
import './TodayLanding.css';

/**
 * The practitioner side for an account that has no day of its own: an admin,
 * finance or a client contact who typed the address. Someone who treats never
 * sees this; App.tsx sends them to the day sheet (app/therapist/today).
 */
export function TodayLanding() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  // An owner or lead practitioner also has a desk on the admin side; offer
  // the way back so the two faces are one app, not two sign-ins.
  const hasConsole = session.status === 'signed-in' && homeFor(session.actor).startsWith('/admin');
  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <h1>Today</h1>
        <div className="small muted">{roles}</div>
        <Note>
          There is no day of visits for this account. Visits belong to practitioners; the console is
          where the rest of the practice's work lives.
        </Note>
        {hasConsole ? (
          <Button onClick={() => navigate('/admin/clients')}>Admin console</Button>
        ) : null}
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    </div>
  );
}
