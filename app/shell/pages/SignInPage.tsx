import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import type { SeededPerson } from '../auth/types';
import { Button, Field, Note } from '../components/Controls';
import { describeRoles, homeFor } from '../routing';

export function SignInPage() {
  const { provider, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      await provider.signIn(email, password);
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
      <div className="signin__mark">McWellness</div>
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
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
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
