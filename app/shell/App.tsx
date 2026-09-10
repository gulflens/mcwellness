import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { hasRole } from '@domain/shared';
import { AuditPage } from '../admin/audit/AuditPage';
import { BooksPage } from '../admin/accounting/BooksPage';
import { BillingPage } from '../admin/billing/BillingPage';
import { ClientsPage } from '../admin/clients/ClientsPage';
import { PinPickerPage } from '../admin/clients/pin/PinPickerPage';
import { EnquiriesPage } from '../admin/enquiries/EnquiriesPage';
import { KitPage } from '../admin/kit/KitPage';
import { TeamPage } from '../admin/settings/TeamPage';
import { SchedulePage } from '../admin/schedule/SchedulePage';
import { WeekPage } from '../admin/schedule/WeekPage';
import { BoardPage } from '../admin/schedule/board/BoardPage';
import { DayMapPage } from '../admin/schedule/map/DayMapPage';
import { PracticePage } from '../admin/settings/PracticePage';
import { PractitionersPage } from '../admin/settings/PractitionersPage';
import { PortalAccessPage } from '../admin/portal/PortalAccessPage';
import { AgreementsScreen } from '../client/AgreementsScreen';
import { FamilyScreen } from '../client/FamilyScreen';
import { HomeScreen } from '../client/HomeScreen';
import { InvitePage } from '../client/InvitePage';
import { MoneyScreen } from '../client/MoneyScreen';
import { PasswordScreen } from '../client/PasswordScreen';
import { ReportsScreen } from '../client/ReportsScreen';
import { PortalRoot } from '../client/PortalRoot';
import { VisitsScreen } from '../client/VisitsScreen';
import { CheckInPage } from '../therapist/session/CheckInPage';
import { TodayPage } from '../therapist/today/TodayPage';
import { TodayLanding } from '../therapist/TodayLanding';
import { AdminLayout } from './AdminLayout';
import {
  canOpenAudit,
  canOpenBilling,
  canOpenBoard,
  canOpenBooks,
  canOpenEnquiries,
  canOpenKit,
  canOpenPin,
  canOpenPortalAccess,
  canOpenPractitioners,
  canOpenSchedule,
  canOpenSettings,
  canOpenTeam,
  canOpenToday,
} from './adminAccess';
import { useAuth, type Actor } from './auth/AuthContext';
import { Note } from './components/Controls';
import { NoAccessPage } from './pages/NoAccessPage';
import { PasswordPage } from './pages/PasswordPage';
import { SignInPage } from './pages/SignInPage';
import { homeFor } from './routing';

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
 * The same wait as `RequireAuthDocument`, for the pin picker's own widened
 * document (`MAP_DOCUMENT_PATHS`, `app/api/_middleware/security.ts`). The
 * mechanism is identical and for the identical reason (finding B2 above): a
 * signed-out visitor is offered a plain anchor, never a `<Navigate>`, because
 * this document too carries `'unsafe-eval'` and `'strict-dynamic'` and a
 * client-side redirect would render the next screen inside it.
 *
 * **Its bar is `canOpenPin`, not merely being signed in.** `/admin/clients`,
 * the screen this page is opened from, admits every signed-in member of
 * staff and has no `canOpenX` gate of its own in `adminAccess.ts` — but
 * `/admin/clients` carries the console's strict policy, and this document
 * does not. A `client_contact` is an actor in the same session
 * (`app/shell/routing.ts`; `/portal` is mounted under this same
 * `RequireAuth`), and no practice data is reachable here, so admitting one
 * is not a data leak — the risk is a household member driving the practice's
 * own browser key and its Places quota from a page handed to them. A widened
 * document takes a higher bar than the strict page it sits beside, so this
 * one checks `canOpenPin` on top of being signed in (the whole-branch review
 * of trunk round 43, finding 5 — an earlier version of this comment justified
 * the looser bar by parity with `/admin/clients`, which was the wrong page to
 * measure against).
 */
function RequirePinDocument({ children }: { children: ReactNode }) {
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
        <h1>Pin picker</h1>
        <Note>Sign in to open the pin picker.</Note>
        <a className="link" href="/sign-in">
          Sign in
        </a>
      </main>
    );
  }
  if (!canOpenPin(session.actor, new Date())) {
    return (
      <main className="plain">
        <h1>Pin picker</h1>
        <Note>You do not have access to the pin picker.</Note>
        <a className="link" href={homeFor(session.actor)}>
          Go to your own screen
        </a>
      </main>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        path="/"
        element={<RequireAuth>{(actor) => <Navigate to={homeFor(actor)} replace />}</RequireAuth>}
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
      {/*
        The pin picker (docs/SPEC/route-planning.md section 8; trunk round
        43, "the pin on a map"), reached the same way and for the same reason
        as the day map above: its own document, carrying the wider content
        security policy Google's Maps JavaScript API needs, opened by a plain
        anchor from a new tab rather than by the router. It renders no
        `Link` of its own into any other screen — "Cancel" and "Use this
        pin" close the tab or post a message and close it — so, unlike the
        day map, it needs no `DocumentBoundary`: there is nothing inside it
        for one to guard.
      */}
      <Route
        path="/admin/clients/pin"
        element={
          <RequirePinDocument>
            <PinPickerPage />
          </RequirePinDocument>
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
          <RequireAuth>
            {(actor) => (canOpenToday(actor) ? <TodayPage /> : <TodayLanding />)}
          </RequireAuth>
        }
      />
      <Route
        path="/today/check-in"
        element={
          <RequireAuth>
            {(actor) =>
              hasRole(actor, 'practitioner', 'lead_practitioner') ? (
                <CheckInPage />
              ) : (
                <Navigate to={homeFor(actor)} replace />
              )
            }
          </RequireAuth>
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
  );
}
