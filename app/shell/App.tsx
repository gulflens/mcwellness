import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { hasRole } from '@domain/shared';
import { BillingPage } from '../admin/billing/BillingPage';
import { ClientsPage } from '../admin/clients/ClientsPage';
import { SchedulePage } from '../admin/schedule/SchedulePage';
import { PortalLanding } from '../client/PortalLanding';
import { CheckInPage } from '../therapist/session/CheckInPage';
import { TodayPage } from '../therapist/today/TodayPage';
import { TodayLanding } from '../therapist/TodayLanding';
import { AdminLayout } from './AdminLayout';
import { canOpenBilling, canOpenSchedule, canOpenToday } from './adminAccess';
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
      <Route path="/portal" element={<RequireAuth>{() => <PortalLanding />}</RequireAuth>} />
      <Route path="/no-access" element={<RequireAuth>{() => <NoAccessPage />}</RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
