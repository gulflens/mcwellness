import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { HomeResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { PortalLanguage, WORDS, say, usePortalLanguage, useWords } from './i18n';
import { usePortalRead, type Loaded } from './usePortal';
import './portal.css';

/**
 * The portal's own root: `dir` and `lang`, the header, and the six screens
 * (docs/SPEC/client-portal.md section 3, and Reports from
 * docs/SPEC/reports-v1.md section 7.3).
 *
 * **One column and no rail.** The wordmark, the practice's name, the language
 * switch, the person's name and sign out across the top, then the screens' own
 * nav, then the column at the 68-character measure. Below 720px the same
 * column at full width; nothing collapses into a drawer, because there is
 * nothing here that needs one.
 *
 * **The direction is declared once, here.** Every rule in `portal.css` is
 * written in logical properties, so setting `dir="rtl"` on this element is what
 * mirrors the whole layout — the Arabic edition is a right-to-left layout, not
 * a flipped English one. `lang` travels with it, so a screen reader reads the
 * Arabic in Arabic.
 *
 * **Home is read here, once.** Every screen needs two things off that answer —
 * the practice's name for the header and its time zone for every date and time
 * — so the root reads it and publishes it, and the Home screen renders from the
 * same answer rather than asking again. That also means the practice's name is
 * in the header on Visits and on Family, not only on the screen that happened
 * to fetch it.
 */

/**
 * The six screens, in the order the header lists them. Reports sits after
 * Money and before Family: it is a thing the practice gives the household,
 * like an invoice, rather than something about the household itself
 * (docs/SPEC/reports-v1.md section 7.3).
 */
export const PORTAL_TABS = [
  { key: 'home', to: '/portal', end: true },
  { key: 'visits', to: '/portal/visits', end: false },
  { key: 'money', to: '/portal/money', end: false },
  { key: 'reports', to: '/portal/reports', end: false },
  { key: 'family', to: '/portal/family', end: false },
  { key: 'agreements', to: '/portal/agreements', end: false },
] as const;

type HomeState = Loaded<HomeResponse> & { reload: () => void };
const HomeCtx = createContext<HomeState | null>(null);

/** Home's own answer, read once by the root. */
export function usePortalHome(): HomeState {
  const value = useContext(HomeCtx);
  if (!value) throw new Error('usePortalHome needs a PortalRoot above it.');
  return value;
}

/**
 * Whether this household is shown money at all (docs/SPEC/client-portal.md
 * section 3.3): true when the record carries at least one client this person
 * may be shown figures for.
 *
 * A young person's own login is shown none, and the answer to that is a portal
 * with four screens rather than a fifth that refuses. So the tab is not
 * rendered and `/portal/money` sends them home — an absence, not a locked door
 * with a note on it. It takes Home's answer to know, so nothing is offered
 * until that answer is in: a tab that appears and then vanishes would be the
 * same mistake, briefly.
 */
export function moneyIsShown(home: Loaded<HomeResponse> | null): boolean {
  return home?.kind === 'ready' && home.data.clients.some((client) => client.moneyVisible);
}

function Header({ practiceName }: { practiceName: string | null }) {
  const words = useWords();
  const { locale, setLocale } = usePortalLanguage();
  const { session, signOut } = useAuth();
  const person = session.status === 'signed-in' ? session.actor.displayName : '';
  const home = useContext(HomeCtx);
  const tabs = PORTAL_TABS.filter((tab) => tab.key !== 'money' || moneyIsShown(home));

  return (
    <header className="portal__header">
      <div className="portal__bar">
        <span className="portal__mark">McWellness</span>
        <span className="portal__practice small">{practiceName ?? ''}</span>
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
              {/* Each language names itself in its own script, which is how a
                  person finds their own without having to read the other. */}
              {option === 'en' ? 'English' : 'العربية'}
            </button>
          ))}
        </div>
        <span className="portal__person small">{person}</span>
        <button type="button" className="button button--quiet" onClick={() => void signOut()}>
          {words.t('signOut')}
        </button>
      </div>
      <nav className="portal__nav" aria-label={say(WORDS.portal, locale)}>
        {tabs.map((tab) => (
          <NavLink key={tab.key} to={tab.to} end={tab.end}>
            {words.t(tab.key)}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

/**
 * The element `dir` and `lang` are set on, and the language switch's own
 * boundary. Separate from `PortalRoot` so a test can mount one screen inside
 * it without the router.
 */
export function PortalShell({
  practiceName = null,
  children,
}: {
  practiceName?: string | null;
  children?: ReactNode;
}) {
  const { locale } = usePortalLanguage();

  useEffect(() => {
    // The document itself, so the scrollbar, the selection and anything else
    // the browser draws outside this element follows the reader too. Put back
    // on the way out: the admin console and the practitioner's app are English.
    const root = document.documentElement;
    const hadLang = root.lang;
    const hadDir = root.dir;
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
    return () => {
      root.lang = hadLang;
      root.dir = hadDir;
    };
  }, [locale]);

  return (
    <div className="portal" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Header practiceName={practiceName} />
      <main className="portal__main">{children ?? <Outlet />}</main>
    </div>
  );
}

/**
 * The shell with Home's answer behind it, once the language is settled.
 * Exported so a screen test can mount one screen inside the same composition
 * the router builds, rather than a second one that could drift from it.
 */
export function PortalWithHome({ children }: { children?: ReactNode }) {
  const home = usePortalRead('/api/portal/home', HomeResponse);
  const { setTimezone } = usePortalLanguage();
  const words = useWords();
  const practice = home.kind === 'ready' ? home.data.practice : null;

  useEffect(() => {
    if (practice) setTimezone(practice.timezone);
  }, [practice, setTimezone]);

  return (
    <HomeCtx.Provider value={home}>
      <PortalShell practiceName={practice?.name ?? null}>
        {home.kind === 'refused' ? (
          <Note tone="critical">{words.t('notYours')}</Note>
        ) : (
          (children ?? <Outlet />)
        )}
      </PortalShell>
    </HomeCtx.Provider>
  );
}

/**
 * What the router renders at `/portal/*`. The person's own language opens it,
 * from `/api/me`; a switch afterwards is remembered in this browser and never
 * sent to the server (section 12).
 */
export function PortalRoot() {
  const { session } = useAuth();
  const initial = session.status === 'signed-in' ? session.actor.preferredLocale : 'en';
  return (
    <PortalLanguage initial={initial}>
      <PortalWithHome />
    </PortalLanguage>
  );
}
