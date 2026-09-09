import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { passwordProblem } from '@domain/shared';
import { useAuth } from '../auth/AuthContext';
import { PasswordChangeError } from '../auth/types';
import { Button, Field, Note } from '../components/Controls';

/**
 * A new password for whoever is signed in (trunk round 40, 2026-09-10). A
 * colleague arrives with a temporary password shown once on Settings › Team;
 * this is where they replace it. Anyone signed in may use it — a member of
 * staff from the console or the phone, a household from the portal — and it
 * asks for the current password and the new one twice: the session says who
 * is asking, the current password proves it is them and not whoever found
 * the device (the projects require it, since 2026-09-10). The rule for what a
 * password may be is the practice's own (domain/shared/password.ts), said
 * here first; Supabase applies its own floor and its leaked-password check
 * beneath. The change itself happens with the sign-in provider; the act is
 * then recorded in the practice's trail through the API, and no password
 * ever crosses that call.
 */
export function PasswordPage() {
  const { provider, apiFetch, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    void provider.currentEmail?.().then((address) => {
      if (live && address) setEmail(address);
    });
    return () => {
      live = false;
    };
  }, [provider]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (current.length === 0) {
      setError('Your current password first.');
      return;
    }
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
      await provider.updatePassword(password, current);
      // The act, not the value: one row in the practice's trail under this
      // person. Best effort — the password is already changed either way.
      await apiFetch('/api/me/password-changed', { method: 'POST' }).catch(() => undefined);
      setDone(true);
      setCurrent('');
      setPassword('');
      setAgain('');
    } catch (failure) {
      if (failure instanceof PasswordChangeError && failure.reason === 'session') {
        await signOut();
        navigate('/sign-in', { replace: true });
        return;
      }
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
          {/* For the password manager's record: which account this is. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <Field
            id="password-current"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
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
