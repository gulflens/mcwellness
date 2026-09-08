import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { readKeepSignedIn, writeKeepSignedIn } from '../auth/session-storage';
import type { SeededPerson } from '../auth/types';
import { Button, Field, Note, PasswordField } from '../components/Controls';
import { describeRoles, homeFor } from '../routing';

export function SignInPage() {
  const { provider, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Ticked unless this browser was asked before and said otherwise.
  const [keepSignedIn, setKeepSignedIn] = useState(readKeepSignedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<SeededPerson[]>([]);

  useEffect(() => {
    let live = true;
    void provider.seededPeople?.().then((list) => {
      if (live) setPeople(list);
    });
    return () => {
      live = false;
    };
  }, [provider]);

  if (session.status === 'signed-in') {
    return <Navigate to={homeFor(session.actor)} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await provider.signIn(email, password, { keepSignedIn });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signInAs = async (authId: string) => {
    setBusy(true);
    setError(null);
    try {
      await provider.signInAs?.(authId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      {/*
        The whole lockup, at a size that lets the tagline and the pulse rule be
        read — which is why the rail shows the mark alone instead
        (docs/brand-assets.md). The alt carries the name here, because unlike
        the rail there is no text beside it.
      */}
      <img
        className="signin__logo"
        src="/brand/lockup.png"
        alt="McWellness"
        width={960}
        height={402}
      />
      <h1>Sign in</h1>
      <form className="signin__form" onSubmit={(e) => void submit(e)}>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {/*
          Ticked is the default, and it is what every sign-in did until this
          round: the session is kept on this device, so closing the browser
          does not sign the person out. Unticked is the new behaviour, not the
          old one — the session is held for this tab alone, so a record opened
          in a new tab asks for sign-in again and closing the browser ends it.
          The answer is remembered per browser and read again on the next
          visit; where the session is actually kept is written at sign-in
          (app/shell/auth/session-storage.ts).
        */}
        <div className="signin__keep">
          <label htmlFor="keep-signed-in" className="checkbox">
            <input
              id="keep-signed-in"
              type="checkbox"
              checked={keepSignedIn}
              onChange={(e) => {
                setKeepSignedIn(e.target.checked);
                writeKeepSignedIn(e.target.checked);
              }}
            />
            <span>Keep me signed in on this browser</span>
          </label>
          {keepSignedIn ? null : (
            <p className="small muted">
              Unticked, you sign in again in each new tab and when the browser closes.
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          Sign in
        </Button>
        {error ? <Note tone="critical">{error}</Note> : null}
      </form>
      {people.length > 0 ? (
        <section className="signin__door" aria-labelledby="door-heading">
          <h2 id="door-heading" className="small">
            On this laptop, sign in as a seeded person
          </h2>
          <ul className="signin__people">
            {people.map((person) => (
              <li key={person.authId}>
                <button
                  type="button"
                  className="signin__person"
                  aria-label={`Sign in as ${person.displayName}`}
                  disabled={busy}
                  onClick={() => void signInAs(person.authId)}
                >
                  <span>{person.displayName}</span>
                  <span className="micro">{describeRoles(person.roles)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Invented people from the synthetic seed. This door does not exist outside development.
          </p>
        </section>
      ) : null}
    </main>
  );
}
