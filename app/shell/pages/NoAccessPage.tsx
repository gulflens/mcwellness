import { useAuth } from '../auth/AuthContext';
import { Button, Note } from '../components/Controls';

export function NoAccessPage() {
  const { signOut } = useAuth();
  return (
    <main className="plain">
      <h1>No access yet</h1>
      <Note>
        Your account exists but holds no role. Ask the practice owner to grant one, then sign in
        again.
      </Note>
      <Button onClick={() => void signOut()}>Sign out</Button>
    </main>
  );
}
