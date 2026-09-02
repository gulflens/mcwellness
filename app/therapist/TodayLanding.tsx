import { useAuth } from '../shell/auth/AuthContext';
import { Button, Note } from '../shell/components/Controls';
import { describeRoles } from '../shell/routing';

/** The instrument's ground, before the instrument: dark, one column, one decision. */
export function TodayLanding() {
  const { session, signOut } = useAuth();
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <div className="micro">{roles}</div>
        <h1>Today</h1>
        <Note>
          The day sheet, the session runner and the route arrive with their own work. Nothing is
          scheduled yet.
        </Note>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    </div>
  );
}
