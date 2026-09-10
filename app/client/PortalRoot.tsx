import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NavLink, Outlet } from 'react-router';
import { HomeResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { MenuIcon } from '../shell/components/Icons';
import { useDrawer } from '../shell/components/useDrawer';
import { tierOf } from '../shell/railState';
import { Note } from '../shell/components/Controls';
import { PortalLanguage, WORDS, say, usePortalLanguage, useWords } from './i18n';
import { usePortalRead, type Loaded } from './usePortal';
import './portal.css';

/**
 * The portal's own root: `dir` and `lang`, the header, and the six screens
 * (docs/SPEC/client-portal.md section 3, and Reports from
 * docs/SPEC/reports-v1.md section 7.3).
 *
 * **A sidebar and a column** (rebuilt 8 September 2026, replacing a header of
 * two wrapping rows). The six screens live in a sidebar on the inline start,
 * and the language switch, the person's name and sign out live in its foot.
 * Beside it, a slim top bar and the column at the 68-character measure.
 *
 * On a phone the sidebar is not there at all until a menu button asks for it,
 * and then it covers the page. It is hidden rather than collapsed to a strip of
 * icons the way the console's rail is: the console's sections have drawn icons
 * and the portal's are words, and six invented icons would be a worse answer
 * than a menu. What it cost before was two rows of wrapping chrome — the bar
 * broke across two lines and the six tabs across two more — which on a 390px
 * screen was most of the first view.
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

function Sidebar({
  onChoose,
  covering,
  away,
  onClose,
}: {
  onChoose: () => void;
  /** Floating over the page: it owes the page a drawer's care. */
  covering: boolean;
  /**
   * Parked off the inline start on a phone with the menu shut. `inert` rather
   * than `visibility: hidden`, which was the first answer and the wrong one: a
   * hidden element cannot take focus, so `useDrawer`'s focus call landed on
   * nothing and the person's focus stayed on the body. `inert` takes it out of
   * the tab order just as completely and is an attribute, so it applies the
   * moment React sets it rather than after a style recalculation.
   */
  away: boolean;
  onClose: () => void;
}) {
  const words = useWords();
  const { locale, setLocale } = usePortalLanguage();
  const { session, signOut } = useAuth();
  const person = session.status === 'signed-in' ? session.actor.displayName : '';
  const home = useContext(HomeCtx);
  const tabs = PORTAL_TABS.filter((tab) => tab.key !== 'money' || moneyIsShown(home));
  const rail = useRef<HTMLElement | null>(null);
  const first = useRef<HTMLAnchorElement | null>(null);

  return (
    <nav className="portal__rail" aria-label={say(WORDS.portal, locale)} ref={rail} inert={away}>
      {/* Covering the page, the sidebar owes it what any drawer owes it:
          focus held inside, everything behind inert, Escape to close. The
          console's rail borrows the same hook rather than a second copy. */}
      {covering ? <Covering rail={rail} first={first} onClose={onClose} /> : null}
      <div className="portal__brand">
        <img className="portal__logo" src="/brand/mark.png" alt="" width={384} height={410} />
        <span className="portal__mark">McWellness</span>
      </div>
      <ul className="portal__sections">
        {tabs.map((tab, index) => (
          <li key={tab.key}>
            <NavLink
              to={tab.to}
              end={tab.end}
              onClick={onChoose}
              ref={index === 0 ? first : undefined}
            >
              {words.t(tab.key)}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="portal__foot">
        <span className="portal__person small">{person}</span>
        {/* Account, not record: the way to a new password sits with the
            person's name and the way out, not among the screens. */}
        <NavLink to="/portal/password" className="portal__account small" onClick={onChoose}>
          {words.t('passwordChange')}
        </NavLink>
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
        <button type="button" className="button button--quiet" onClick={() => void signOut()}>
          {words.t('signOut')}
        </button>
      </div>
    </nav>
  );
}

/** A hook cannot be called conditionally, so the covering behaviour is a child. */
function Covering({
  rail,
  first,
  onClose,
}: {
  rail: React.RefObject<HTMLElement | null>;
  first: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useDrawer(rail, first, onClose);
  return null;
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
  const words = useWords();
  // Shut on arrival, and only ever meaningful while the sidebar covers.
  const [open, setOpen] = useState(false);
  // The tier is known here rather than left to the stylesheet alone, because
  // two things need it that CSS cannot do: taking the closed sidebar out of
  // the tab order, and knowing whether opening it should trap focus. It
  // follows the window, because a person rotates a tablet.
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const covering = tierOf(width) === 'compact';
  // Stable, because useDrawer holds it in an effect's dependency list.
  const close = useCallback(() => setOpen(false), []);

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
      <div className="portal__shell" data-nav={open ? 'open' : 'closed'}>
        <Sidebar
          covering={covering && open}
          away={covering && !open}
          onClose={close}
          onChoose={() => setOpen(false)}
        />
        {covering && open ? (
          // A press anywhere on the page closes the menu. Not announced and not
          // in the tab order: Escape and the button are the announced ways out,
          // and useDrawer has already made everything behind inert.
          <button
            type="button"
            className="portal__scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
          />
        ) : null}
        <div className="portal__body">
          <header className="portal__top">
            <button
              type="button"
              className="portal__menu"
              onClick={() => setOpen((was) => !was)}
              aria-expanded={open}
            >
              <MenuIcon />
              <span className="visually-hidden">{words.t('menu')}</span>
            </button>
            {/* With the menu shut on a phone the sidebar is not there to carry
                the mark, so the bar does. Above the tablet tier the sidebar is
                always showing and the stylesheet hides this one, rather than
                the household seeing it twice. */}
            <img
              className="portal__top-logo"
              src="/brand/mark.png"
              alt="McWellness"
              width={384}
              height={410}
            />
            <span className="portal__practice small">{practiceName ?? ''}</span>
          </header>
          <main className="portal__main">
            {/*
             * A screen arrives when the household opens it rather than in the
             * file everybody downloads at sign-in, so the wait sits inside the
             * portal's own chrome: the sidebar and the header stay, and only
             * this panel is briefly empty. Nothing is drawn in the gap — the
             * screen says what it is fetching once it is here.
             */}
            <Suspense fallback={null}>{children ?? <Outlet />}</Suspense>
          </main>
        </div>
      </div>
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
