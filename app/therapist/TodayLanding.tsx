import { useNavigate } from 'react-router';
import { canOpenPractitioners } from '../shell/adminAccess';
import { useAuth } from '../shell/auth/AuthContext';
import { Button, Note } from '../shell/components/Controls';
import { describeRoles, homeFor } from '../shell/routing';
import './TodayLanding.css';

/**
 * The practitioner side for an account that has no day of its own: an admin,
 * finance or a client contact who typed the address. Someone who treats never
 * sees this; App.tsx sends them to the day sheet (app/therapist/today).
 *
 * **"Your home base" is here anyway, on the same rule the day sheet uses.**
 * `canOpenToday` admits `practitioner` and `lead_practitioner`, so as App.tsx
 * routes today nobody who may set a base and lacks the console reaches this
 * screen. The control is written here regardless, so the two faces of `/today`
 * carry the same door: if that routing ever changes, the person who needs it
 * does not lose it silently. The condition is what decides, not the file.
 */
export function TodayLanding() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  // An owner or lead practitioner also has a desk on the admin side; offer
  // the way back so the two faces are one app, not two sign-ins.
  const hasConsole = session.status === 'signed-in' && homeFor(session.actor).startsWith('/admin');
  // The door to the one console screen this face's own person may need
  // (see the note above). Never shown beside the console button: somebody who
  // has that has the rail, and the rail carries Settings.
  const canSetOwnBase =
    session.status === 'signed-in' &&
    !hasConsole &&
    canOpenPractitioners(session.actor, new Date());
  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        {/*
          On this ground the mark's own circle is #380473 against #10191d, which
          is 1.22 and would leave the linework floating, so it sits on a plate
          (docs/SPEC/coloured-shell.md section 6). Decorative: the heading below
          says where this is.
        */}
        <img className="today__logo" src="/brand/mark.png" alt="" width={384} height={410} />
        <h1>Today</h1>
        <div className="small muted">{roles}</div>
        <Note>
          There is no day of visits for this account. Visits belong to practitioners; the console is
          where the rest of the practice's work lives.
        </Note>
        {hasConsole ? (
          <Button onClick={() => navigate('/admin/clients')}>Admin console</Button>
        ) : null}
        {canSetOwnBase ? (
          <Button onClick={() => navigate('/admin/settings/practitioners')}>Your home base</Button>
        ) : null}
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    </div>
  );
}
