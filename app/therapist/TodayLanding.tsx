import { useNavigate } from 'react-router';
import { useAuth } from '../shell/auth/AuthContext';
import { Button, Note } from '../shell/components/Controls';
import { describeRoles, homeFor } from '../shell/routing';
import './TodayLanding.css';

/** The instrument's ground, before the instrument: dark, one column, one decision. */
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
          The day sheet, the session runner and the route arrive with their own work. Nothing is
          scheduled yet.
        </Note>
        <Button
          variant="primary"
          className="today__primary"
          onClick={() => navigate('/today/check-in')}
        >
          Check in
        </Button>
        {hasConsole ? (
          <Button onClick={() => navigate('/admin/clients')}>Admin console</Button>
        ) : null}
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    </div>
  );
}
