import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { hasRole } from '@domain/shared';
import { AuditPage } from '../admin/audit/AuditPage';
import { BooksPage } from '../admin/accounting/BooksPage';
import { BillingPage } from '../admin/billing/BillingPage';
import { ClientsPage } from '../admin/clients/ClientsPage';
import { KitPage } from '../admin/kit/KitPage';
import { SchedulePage } from '../admin/schedule/SchedulePage';
import { WeekPage } from '../admin/schedule/WeekPage';
import { PracticePage } from '../admin/settings/PracticePage';
import { PortalAccessPage } from '../admin/portal/PortalAccessPage';
import { AgreementsScreen } from '../client/AgreementsScreen';
import { FamilyScreen } from '../client/FamilyScreen';
import { HomeScreen } from '../client/HomeScreen';
import { InvitePage } from '../client/InvitePage';
import { MoneyScreen } from '../client/MoneyScreen';
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
  canOpenBooks,
  canOpenKit,
  canOpenPortalAccess,
  canOpenSchedule,
  canOpenSettings,
  canOpenToday,
} from './adminAccess';
import { useAuth, type Actor } from './auth/AuthContext';
import { Note } from './components/Controls';
import { NoAccessPage } from './pages/NoAccessPage';
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

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        path="/"
        element={<RequireAuth>{(actor) => <Navigate to={homeFor(actor)} replace />}</RequireAuth>}
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
      </Route>
      <Route path="/no-access" element={<RequireAuth>{() => <NoAccessPage />}</RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
