import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { passwordProblemKey, type PasswordProblemKey } from '@domain/shared';
import { useAuth } from '../auth/AuthContext';
import { PasswordChangeError, type PasswordChangeReason } from '../auth/types';
import { Button, Field, Note } from './Controls';

/**
 * The one form that changes a password, worn by two pages (trunk round 41,
 * 2026-09-10): the console's `PasswordPage`, in English, and the household's
 * `PasswordScreen` in the portal, in the person's own language. The words are
 * the page's; everything else is here once. It asks for the current password
 * and the new one twice — the session says who is asking, the current
 * password proves it is them and not whoever found the device (the projects
 * require it, since 2026-09-10) — checks the practice's own rule for what a
 * password may be (domain/shared/password.ts) before asking the provider,
 * which applies its own floor and its leaked-password check beneath, and then
 * records the act, never the value, in the practice's trail through the API.
 * A session that has gone signs the person out rather than pretending.
 */
export type PasswordWords = {
  current: string;
  next: string;
  again: string;
  hint: string;
  currentFirst: string;
  mismatch: string;
  noPassword: string;
  failed: string;
  done: string;
  submit: string;
  back: string;
  /** The practice's own rule, refused: one sentence per key. */
  problem(key: PasswordProblemKey): string;
  /** The provider's refusal, by reason; `sentence` is the provider's English. */
  refused(reason: PasswordChangeReason, sentence: string): string;
};

export function PasswordForm({
  words,
  classes,
}: {
  words: PasswordWords;
  /** The page's own classes for the form and its row of buttons. */
  classes: { form: string; actions: string };
}) {
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
      setError(words.currentFirst);
      return;
    }
    const problem = passwordProblemKey(password);
    if (problem) {
      setError(words.problem(problem));
      return;
    }
    if (password !== again) {
      setError(words.mismatch);
      return;
    }
    if (!provider.updatePassword) {
      setError(words.noPassword);
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
      if (failure instanceof PasswordChangeError) {
        if (failure.reason === 'session') {
          await signOut();
          navigate('/sign-in', { replace: true });
          return;
        }
        setError(words.refused(failure.reason, failure.message));
      } else {
        setError(words.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <Note tone="attention">{words.done}</Note>
        <Button onClick={() => navigate(-1)}>{words.back}</Button>
      </>
    );
  }

  return (
    <form className={classes.form} onSubmit={(e) => void submit(e)}>
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
        label={words.current}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <Field
        id="password-new"
        label={words.next}
        type="password"
        autoComplete="new-password"
        hint={words.hint}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        id="password-again"
        label={words.again}
        type="password"
        autoComplete="new-password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
      />
      {error ? <Note tone="critical">{error}</Note> : null}
      <div className={classes.actions}>
        <Button type="submit" variant="primary" disabled={busy}>
          {words.submit}
        </Button>
        <Button type="button" variant="quiet" onClick={() => navigate(-1)}>
          {words.back}
        </Button>
      </div>
    </form>
  );
}
