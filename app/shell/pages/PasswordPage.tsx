import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { passwordProblem } from '@domain/shared';
import { useAuth } from '../auth/AuthContext';
import { Button, Field, Note } from '../components/Controls';

/**
 * A new password for whoever is signed in (trunk round 40, 2026-09-10). A
 * colleague arrives with a temporary password shown once on Settings › Team;
 * this is where they replace it. Anyone signed in may use it — a member of
 * staff from the console or the phone, a household from the portal — and it
 * asks for nothing but the new password twice, because the session itself is
 * the proof of who is asking. The rule for what a password may be is the
 * practice's own (domain/shared/password.ts).
 */
export function PasswordPage() {
  const { provider } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== again) {
      setError('The two do not match.');
      return;
    }
    if (!provider.updatePassword) {
      setError('This sign-in has no password to change.');
      return;
    }
    setBusy(true);
    try {
      await provider.updatePassword(password);
      setDone(true);
      setPassword('');
      setAgain('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="plain">
      <h1>Change your password</h1>
      {done ? (
        <>
          <Note tone="attention">Changed. Use the new one from your next sign-in.</Note>
          <Button onClick={() => navigate(-1)}>Back</Button>
        </>
      ) : (
        <form className="signin__form" onSubmit={(e) => void submit(e)}>
          <Field
            id="password-new"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least twelve characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="password-again"
            label="The same again"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {error ? <Note tone="critical">{error}</Note> : null}
          <div className="team__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Change password
            </Button>
            <Button type="button" variant="quiet" onClick={() => navigate(-1)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
