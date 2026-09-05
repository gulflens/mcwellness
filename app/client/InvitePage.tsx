import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PASSWORD_MIN_LENGTH, RedeemResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Field, Note } from '../shell/components/Controls';
import { PortalLanguage, WORDS, say, usePortalLanguage, useWords } from './i18n';
import './portal.css';

/**
 * `/portal/invite/:token` — the way in, reachable signed out
 * (docs/SPEC/client-portal.md section 3.7).
 *
 * One form: an email address, a password, and the password again. On success
 * the page signs the person in with what they have just chosen and lands them
 * on Home.
 *
 * **A dead link says one sentence and no more.** Expired, used, revoked and
 * never-existed all read the same — "this link no longer works; ask the
 * practice for a new one" — because the door itself answers one status, 404,
 * for all four, and a page that guessed would undo that (section 10).
 *
 * **The token stays in the path and goes nowhere else.** It is not logged, not
 * put in a query string and never rendered into the page; it is read from the
 * route and posted in the body.
 *
 * **Two ways in, one page.** With a Supabase project the browser signs in with
 * the address and password the person has just set. On a laptop there is no
 * project: the door answers the auth id it minted through the fake seam, and
 * the development provider signs a token for it — which is what makes the whole
 * invitation path walkable with the real implementation switched off
 * (docs/SEAMS.md).
 */

type State = 'idle' | 'sending' | 'dead' | 'emailTaken' | 'unavailable' | 'failed';

function InviteForm() {
  const words = useWords();
  const { locale, setLocale } = usePortalLanguage();
  const { provider } = useAuth();
  const navigate = useNavigate();
  const { token = '' } = useParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [state, setState] = useState<State>('idle');
  const [fieldError, setFieldError] = useState<'email' | 'password' | 'again' | null>(null);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (password !== again) {
        setFieldError('again');
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setFieldError('password');
        return;
      }
      setFieldError(null);
      setState('sending');

      void fetch('/api/portal/invite/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email, password }),
      })
        .then(async (res) => {
          if (res.status === 404) {
            setState('dead');
            return;
          }
          if (res.status === 409) {
            setState('emailTaken');
            return;
          }
          if (res.status === 503) {
            setState('unavailable');
            return;
          }
          if (res.status === 400) {
            const body = (await res.json().catch(() => ({}))) as { code?: string };
            setFieldError(body.code === 'email' ? 'email' : 'password');
            setState('idle');
            return;
          }
          if (!res.ok) {
            setState('failed');
            return;
          }
          const answer = RedeemResponse.parse(await res.json());
          // A laptop: the door minted the sign-in through the fake seam and the
          // development provider signs a token for it. A real project: the
          // browser signs in with what they have just chosen.
          if (answer.authId && provider.signInAs) await provider.signInAs(answer.authId);
          else await provider.signIn(email, password);
          void navigate('/portal', { replace: true });
        })
        .catch(() => setState('failed'));
    },
    [token, email, password, again, provider, navigate],
  );

  if (state === 'dead') {
    return (
      <main className="portal__main">
        <Note tone="critical">{words.t('linkDead')}</Note>
      </main>
    );
  }

  return (
    <main className="portal__main">
      <section className="portal__section">
        <h1>{words.t('setUpSignIn')}</h1>
        <p>{words.t('setUpSignInBody')}</p>
        <form className="portal__form" onSubmit={submit}>
          <Field
            id="portal-invite-email"
            label={words.t('email')}
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldError(null);
            }}
            error={fieldError === 'email' ? words.t('badEmail') : undefined}
          />
          <Field
            id="portal-invite-password"
            label={words.t('passwordLabel')}
            hint={words.t('passwordRule')}
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldError(null);
            }}
            error={fieldError === 'password' ? words.t('passwordRule') : undefined}
          />
          <Field
            id="portal-invite-password-again"
            label={words.t('passwordAgainLabel')}
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => {
              setAgain(e.target.value);
              setFieldError(null);
            }}
            error={fieldError === 'again' ? words.t('passwordsDiffer') : undefined}
          />
          <div className="portal__actions">
            <button type="submit" className="button button--primary" disabled={state === 'sending'}>
              {words.t('send')}
            </button>
            <div className="portal__languages" role="group" aria-label={words.t('language')}>
              {(['en', 'ar'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="portal__language small"
                  lang={option}
                  aria-pressed={locale === option}
                  onClick={() => setLocale(option)}
                >
                  {option === 'en' ? 'English' : 'العربية'}
                </button>
              ))}
            </div>
          </div>
          <div role="status">
            {state === 'emailTaken' ? <Note tone="critical">{words.t('emailTaken')}</Note> : null}
            {state === 'unavailable' ? (
              <Note tone="critical">{words.t('signInsUnavailable')}</Note>
            ) : null}
            {state === 'failed' ? <Note tone="critical">{words.t('tryTheLinkAgain')}</Note> : null}
          </div>
        </form>
      </section>
    </main>
  );
}

/** The page the router renders, with its own language boundary and direction. */
export function InvitePage() {
  return (
    <PortalLanguage>
      <InvitePageBody />
    </PortalLanguage>
  );
}

function InvitePageBody() {
  const { locale } = usePortalLanguage();
  return (
    <div className="portal" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="portal__header">
        <div className="portal__bar">
          <span className="portal__mark">McWellness</span>
          <span className="portal__practice small">{say(WORDS.portal, locale)}</span>
        </div>
      </header>
      <InviteForm />
    </div>
  );
}
