import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { hasRole } from '@domain/shared';
import { PortalRoot } from '../client/PortalRoot';
import { AdminLayout } from './AdminLayout';
import {
  canOpenAudit,
  canOpenBilling,
  canOpenBoard,
  canOpenBooks,
  canOpenEnquiries,
  canOpenKit,
  canOpenPortalAccess,
  canOpenPractitioners,
  canOpenSchedule,
  canOpenSettings,
  canOpenTeam,
  canOpenToday,
} from './adminAccess';
import { useAuth, type Actor } from './auth/AuthContext';
import { Note } from './components/Controls';
import { ScreenBoundary } from './ScreenBoundary';
import { NoAccessPage } from './pages/NoAccessPage';
import { PasswordPage } from './pages/PasswordPage';
import { SignInPage } from './pages/SignInPage';
import { homeFor } from './routing';

/**
 * A screen the browser fetches the first time somebody opens it, rather than
 * in the one file everybody downloads at sign-in.
 *
 * Until this, a household signing in to read a report on their phone carried
 * the whole practice with them — every admin screen, the practitioner's day,
 * the books — because the build put all three role areas in a single file.
 * Each screen named below becomes its own piece, so a person downloads their
 * own part and the parts they actually open.
 *
 * What stays in the first file, deliberately, and what it costs. The sign-in
 * page, because it is the first thing every person sees and a second round
 * trip in front of it would be slower, not faster. And the two chromes —
 * `AdminLayout` and `PortalRoot` — so the rail and the household's sidebar
 * paint at once rather than after a fetch, and so the first screen inside
 * them is one fetch away rather than two. `NoAccessPage` and `PasswordPage`
 * ride along with them: both are a few lines and both are reached from a
 * standing start.
 *
 * The cost is that everybody carries both chromes, including a household who
 * will never open the console. That is the trade taken deliberately: the rail
 * is small beside React and the sign-in library, which every person needs
 * whoever they are, and blanking a person's own navigation to save it would
 * be the wrong economy (the review of pull request 152, findings 1, 2 and 5).
 *
 * The screens are named exports, so each is unwrapped here into the default
 * export `lazy` expects.
 */
function screen<Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name,
): ComponentType {
  return lazy(async () => {
    const module = await load();
    const Screen: ComponentType = module[name];
    return { default: Screen };
  });
}

const AuditPage = screen(() => import('../admin/audit/AuditPage'), 'AuditPage');
const BooksPage = screen(() => import('../admin/accounting/BooksPage'), 'BooksPage');
const BillingPage = screen(() => import('../admin/billing/BillingPage'), 'BillingPage');
const ClientsPage = screen(() => import('../admin/clients/ClientsPage'), 'ClientsPage');
const EnquiriesPage = screen(() => import('../admin/enquiries/EnquiriesPage'), 'EnquiriesPage');
const KitPage = screen(() => import('../admin/kit/KitPage'), 'KitPage');
const TeamPage = screen(() => import('../admin/settings/TeamPage'), 'TeamPage');
const SchedulePage = screen(() => import('../admin/schedule/SchedulePage'), 'SchedulePage');
const WeekPage = screen(() => import('../admin/schedule/WeekPage'), 'WeekPage');
const BoardPage = screen(() => import('../admin/schedule/board/BoardPage'), 'BoardPage');
const DayMapPage = screen(() => import('../admin/schedule/map/DayMapPage'), 'DayMapPage');
const PracticePage = screen(() => import('../admin/settings/PracticePage'), 'PracticePage');
const PractitionersPage = screen(
  () => import('../admin/settings/PractitionersPage'),
  'PractitionersPage',
);
const PortalAccessPage = screen(
  () => import('../admin/portal/PortalAccessPage'),
  'PortalAccessPage',
);
const AgreementsScreen = screen(() => import('../client/AgreementsScreen'), 'AgreementsScreen');
const FamilyScreen = screen(() => import('../client/FamilyScreen'), 'FamilyScreen');
const HomeScreen = screen(() => import('../client/HomeScreen'), 'HomeScreen');
const InvitePage = screen(() => import('../client/InvitePage'), 'InvitePage');
const MoneyScreen = screen(() => import('../client/MoneyScreen'), 'MoneyScreen');
const PasswordScreen = screen(() => import('../client/PasswordScreen'), 'PasswordScreen');
const ReportsScreen = screen(() => import('../client/ReportsScreen'), 'ReportsScreen');
const VisitsScreen = screen(() => import('../client/VisitsScreen'), 'VisitsScreen');
const CheckInPage = screen(() => import('../therapist/session/CheckInPage'), 'CheckInPage');
const TodayPage = screen(() => import('../therapist/today/TodayPage'), 'TodayPage');
const TodayLanding = screen(() => import('../therapist/TodayLanding'), 'TodayLanding');

/** Waits for the session, then either renders or sends the person to sign in. */
function RequireAuth({ children }: { children: (actor: Actor) => ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (session.status === 'loading') {
    return (
      <main className="plain">
        <Note>Checking who you are.</Note>
      </main>
    );
  }
  if (session.status === 'signed-out') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <>{children(session.actor)}</>;
}

/**
 * The same wait, for the one document the API serves with the wider content
 * security policy a browser map needs (`app/api/_middleware/security.ts`,
 * docs/SPEC/route-planning.md section 8, docs/SECURITY.md).
 *
 * **Every way out of this page is a plain anchor, never a `<Navigate>`.**
 * `RequireAuth` redirects on the client, which renders the next screen inside
 * the document already loaded — and this document carries `'unsafe-eval'` and
 * `'strict-dynamic'`. A person handed `/admin/schedule/map` with no session
 * would have had the practice's sign-in form rendered under those grants, and
 * a practitioner would have had their own Today (the review of this pull
 * request, finding B2). An anchor makes the browser load a new document, and
 * the strict policy comes with it.
 *
 * For the same reason the route is mounted outside `/admin` and carries no
 * rail: the rail navigates with `NavLink`, so Clients, Billing, Books, Audit
 * and Settings were each one click from being rendered here. Losing it is the
 * design brief's own intent — 6.2 calls this "the one full-bleed screen — map
 * fills the viewport, practitioner list overlays left, no chrome competing
 * with it".
 *
 * And inside the page the same rule is kept by construction rather than by
 * memory: `DayMapPage` wraps its whole tree, drawers included, in the
 * `DocumentBoundary` of `app/admin/schedule/map/documentBoundary.tsx`, where a
 * `BoundaryLink` renders a plain anchor. The call-off drawer's way through to
 * Billing is shared with the Schedule page and was a client-side `Link`, which
 * carried the rail and every screen behind it into this document (the re-check
 * of that same pull request).
 */
function RequireAuthDocument({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (session.status === 'loading') {
    return (
      <main className="plain">
        <Note>Checking who you are.</Note>
      </main>
    );
  }
  if (session.status === 'signed-out') {
    return (
      <main className="plain">
        <h1>Day map</h1>
        <Note>Sign in to open the day map.</Note>
        <a className="link" href="/sign-in">
          Sign in
        </a>
      </main>
    );
  }
  if (!canOpenSchedule(session.actor, new Date())) {
    return (
      <main className="plain">
        <h1>Day map</h1>
        <Note>You do not have access to the schedule.</Note>
        <a className="link" href={homeFor(session.actor)}>
          Go to your own screen
        </a>
      </main>
    );
  }
  return <>{children}</>;
}

/**
 * What the practitioner waits on while their screen arrives.
 *
 * Their three screens are the one part of the app with no chrome around them
 * — the design brief asks for "no chrome during a session" — so there is no
 * rail to hold the ground while a screen loads, and the page underneath is
 * the console's light paper (`app/shell/base.css`). Waiting on nothing there
 * meant a white flash before the dark screen painted, on the one device most
 * likely to be on poor signal (the review of pull request 152, finding 3).
 *
 * So the wait is the ground itself, empty: the same dark surface the screen
 * is about to draw on, which is no flash at all.
 */
function DarkGround() {
  return <div className="ground" data-ground="dark" />;
}

export function App() {
  return (
    // The outer wait, for the screens that stand on their own: the map, an
    // invitation, the practitioner's day. The console and the portal each
    // hold their own wait inside their chrome, so their navigation stays on
    // screen while the next screen arrives; those inner ones answer first.
    // Nothing is drawn in the gap on purpose — a screen announces itself when
    // it has its data, and a second spinner in front of that would be one
    // loading state too many.
    <ScreenBoundary>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>{(actor) => <Navigate to={homeFor(actor)} replace />}</RequireAuth>
            }
          />
          {/*
        The day map (docs/SPEC/route-planning.md section 4.1), reached by a
        plain anchor rather than a Link because it is served as its own
        document with the wider policy a browser map needs. **Deliberately
        outside the `/admin` layout route**, so it carries no rail and no
        client-side way into any other screen of the practice: the widened
        document renders the day map and nothing else, by construction. The
        path is unchanged, so every link and the middleware's exact-match list
        stand as they were.
      */}
          <Route
            path="/admin/schedule/map"
            element={
              <RequireAuthDocument>
                <DayMapPage />
              </RequireAuthDocument>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth>{(actor) => <AdminLayout actorName={actor.displayName} />}</RequireAuth>
            }
          >
            <Route index element={<Navigate to="/admin/clients" replace />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route
              path="billing"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenBilling(actor, new Date()) ? (
                      <BillingPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="books"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenBooks(actor, new Date()) ? (
                      <BooksPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="schedule"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenSchedule(actor, new Date()) ? (
                      <SchedulePage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="schedule/week"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenSchedule(actor, new Date()) ? (
                      <WeekPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            {/*
          The dispatcher's board (docs/SPEC/dispatch.md section 4.1). An
          ordinary nested route inside the console, unlike the day map above:
          it loads no third-party script, so it carries the console's own
          strict content security policy and needs no document of its own.
          It asks its own route's rule, `appointment.board.read`, rather than
          borrowing the schedule's: the two admit the same three roles today,
          which is why the link in the Schedule header is unconditional, but
          they are separate actions and either may narrow without the other.
        */}
            <Route
              path="schedule/board"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenBoard(actor, new Date()) ? (
                      <BoardPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            {/*
          Who can open a household's own record (docs/SPEC/client-portal.md
          section 3.8). The same rule the route enforces, so the rail never
          offers a link a route would bounce the person straight out of.
        */}
            <Route
              path="portal"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenPortalAccess(actor, new Date()) ? (
                      <PortalAccessPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="kit"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenKit(actor, new Date()) ? (
                      <KitPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="audit"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenAudit(actor, new Date()) ? (
                      <AuditPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="enquiries"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenEnquiries(actor, new Date()) ? (
                      <EnquiriesPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="settings/practice"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenSettings(actor, new Date()) ? (
                      <PracticePage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            {/*
          The second settings screen, and the one with a wider audience than
          the first: a practitioner records their own home base here
          (docs/SPEC/route-planning.md section 5.4). The rail's single Settings
          entry is shown to anyone who may open either screen and lands on the
          first one they may actually open (`settingsHomeFor`,
          app/shell/adminAccess.ts), and the two screens link to each other
          (SettingsNav.tsx).
        */}
            <Route
              path="settings/practitioners"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenPractitioners(actor, new Date()) ? (
                      <PractitionersPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
            <Route
              path="settings/team"
              element={
                <RequireAuth>
                  {(actor) =>
                    canOpenTeam(actor, new Date()) ? (
                      <TeamPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              }
            />
          </Route>
          <Route
            path="/today"
            element={
              <Suspense fallback={<DarkGround />}>
                <RequireAuth>
                  {(actor) => (canOpenToday(actor) ? <TodayPage /> : <TodayLanding />)}
                </RequireAuth>
              </Suspense>
            }
          />
          <Route
            path="/today/check-in"
            element={
              <Suspense fallback={<DarkGround />}>
                <RequireAuth>
                  {(actor) =>
                    hasRole(actor, 'practitioner', 'lead_practitioner') ? (
                      <CheckInPage />
                    ) : (
                      <Navigate to={homeFor(actor)} replace />
                    )
                  }
                </RequireAuth>
              </Suspense>
            }
          />
          {/*
        The invitation page is deliberately outside RequireAuth: the person on
        the other end of the link has no session yet, and getting one is what
        the page is for (docs/SPEC/client-portal.md section 3.7).
      */}
          <Route path="/portal/invite/:token" element={<InvitePage />} />
          <Route path="/portal" element={<RequireAuth>{() => <PortalRoot />}</RequireAuth>}>
            <Route index element={<HomeScreen />} />
            <Route path="visits" element={<VisitsScreen />} />
            <Route path="money" element={<MoneyScreen />} />
            <Route path="reports" element={<ReportsScreen />} />
            <Route path="family" element={<FamilyScreen />} />
            <Route path="agreements" element={<AgreementsScreen />} />
            {/* The household's own password, in their language; the console's
            English page at /account/password is the staff's. */}
            <Route path="password" element={<PasswordScreen />} />
          </Route>
          <Route path="/no-access" element={<RequireAuth>{() => <NoAccessPage />}</RequireAuth>} />
          <Route
            path="/account/password"
            element={<RequireAuth>{() => <PasswordPage />}</RequireAuth>}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ScreenBoundary>
  );
}
