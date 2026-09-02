import { useAuth } from '../shell/auth/AuthContext';
import { Button, Note } from '../shell/components/Controls';

/** The record's ground: calm, generous, low density. */
export function PortalLanding() {
  const { signOut } = useAuth();
  return (
    <main className="plain plain--record">
      <h1>Your record</h1>
      <Note>Progress in plain language, sessions and reports arrive with the portal work.</Note>
      <Button onClick={() => void signOut()}>Sign out</Button>
    </main>
  );
}
