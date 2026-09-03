import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  directionsUrl,
  isSettled,
  navigationTarget,
  practiceDate,
  PRACTICE_TIME_ZONE,
  stopPhases,
  type AppointmentStatus,
  type StopPhase,
} from '@domain/scheduling';
import { AppointmentListResponse, type AppointmentRow } from '../../api/appointments/schema';
import { useAuth, type ApiFetch } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { describeRoles, homeFor } from '../../shell/routing';
import './today.css';

/**
 * The practitioner's day (docs/SPEC/scheduling-manual.md section 5.1). One
 * column on the dark ground, one stop after another: the arrival window, who
 * is behind the door, where it is, the drive, and the way into check-in. The
 * current stop is emphasised and the ones behind it collapse to a line.
 *
 * Deliberately not here:
 *
 * - **Brief.** Section 5.1 asks for one, and it needs the client brief the
 *   client-record stream owns (protocol summary, last session notes, access
 *   notes, contacts). Nothing on this screen invents a shortcut to it.
 * - **Offline.** Section 5.1 also asks this screen to render from the last
 *   sync, and section 11 makes that a condition of the stage. There is no
 *   local store yet, so the screen says what it can do rather than pretending
 *   the day is cached.
 *
 * Nothing here shows an identity number or a clinical note (section 11). The
 * record number is the practice's own MW-000123, which the check-in screen
 * already asks the practitioner to type; this screen saves them typing it.
 */

// Mirrors app/admin/clients/ClientsPage.tsx's own map. Kept local rather than
// imported across streams: this screen renders one emirate name, not a shared
// vocabulary, and the day it needs a second copy is the day it belongs in the
// shell's component library.
const EMIRATES: Record<string, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};

const LOCATION_LABELS: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  school: 'School',
  studio: 'Studio',
  base: 'Base',
  other: 'Other',
};

/**
 * The statuses worth a word on a day sheet, and the word for each.
 *
 * The coordinator's ledger gives every row a status chip because a table is
 * scanned across; a practitioner reads one column at arm's length and only
 * needs telling when the status changes what they do. `confirmed` is the
 * ordinary case and says nothing at all.
 *
 * The two cancelled statuses are covered even though the own scope does not
 * send them today (app/api/appointments/list.ts drops a cancelled visit from
 * a day sheet): a map with a hole in it is a worse thing to hand a component
 * than a map with a branch that rarely fires.
 */
const STOP_NOTES: Partial<Record<AppointmentStatus, string>> = {
  proposed: 'Not yet confirmed with the client',
  checked_in: 'Checked in',
  completed: 'Done',
  cancelled: 'Cancelled',
  cancelled_late: 'Cancelled',
  no_show: 'Nobody answered',
  rescheduled: 'Moved to another day',
};

const CRITICAL_STATUSES: readonly AppointmentStatus[] = [
  'cancelled',
  'cancelled_late',
  'no_show',
] as const;

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

// A day sheet left open goes stale: the emphasised stop is the one whose
// window has opened, and windows open while nobody touches the screen. A
// minute is fine for a 45-minute window, and it is a re-render, not motion.
const CLOCK_TICK_MS = 60_000;

// Asia/Dubai carries no daylight-saving change, so the day being shown
// always starts at this exact offset from UTC.
const PRACTICE_UTC_OFFSET = '+04:00';

const LOAD_ERROR = 'Your day could not be loaded. Check your connection, then try again.';

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; stops: readonly AppointmentRow[] };

function formatWindow(windowStart: string, windowEnd: string): string {
  return `${TIME_FORMAT.format(new Date(windowStart))}–${TIME_FORMAT.format(new Date(windowEnd))}`;
}

/** First name and family initial (section 5.1), never the full family name. */
function shortName(client: AppointmentRow['client']): string {
  const initial = client.familyName.trim().slice(0, 1);
  return initial ? `${client.givenName} ${initial}.` : client.givenName;
}

function describeAge(age: number | null | undefined): string | null {
  if (age === null || age === undefined) {
    return null;
  }
  return age === 1 ? '1 year old' : `${age} years old`;
}

function describePlace(location: AppointmentRow['location']): string {
  const label = LOCATION_LABELS[location.label] ?? location.label;
  const emirate = EMIRATES[location.emirate] ?? location.emirate;
  return `${label}, ${emirate}`;
}

/** The Google Maps hand-off, or null when the row carries no coordinate. */
function navigateHref(location: AppointmentRow['location']): string | null {
  const entrancePoint = location.entrancePoint;
  if (!entrancePoint) {
    return null;
  }
  // Coordinates only, never a name or an address: docs/COMPLIANCE/approved-vendors.md
  // holds Google Maps to exactly that, and the app sends no referrer either.
  return directionsUrl(
    navigationTarget({ entrancePoint, parkingPoint: location.parkingPoint ?? null }),
  );
}

function fetchDay(apiFetch: ApiFetch, date: string): Promise<State> {
  return apiFetch(`/api/appointments?date=${date}&scope=own`)
    .then(async (res) => {
      if (!res.ok) return { kind: 'error' } as const;
      const parsed = AppointmentListResponse.safeParse(await res.json());
      if (!parsed.success) return { kind: 'error' } as const;
      return { kind: 'ready', stops: parsed.data.appointments } as const;
    })
    .catch(() => ({ kind: 'error' }) as const);
}

function Stop({
  stop,
  phase,
  onCheckIn,
}: {
  stop: AppointmentRow;
  phase: StopPhase;
  onCheckIn: (stop: AppointmentRow) => void;
}) {
  const name = shortName(stop.client);
  const age = describeAge(stop.client.age);
  const note = STOP_NOTES[stop.status];
  const href = navigateHref(stop.location);
  const collapsed = phase === 'past';
  const settled = isSettled(stop.status);

  return (
    <li className={`stop stop--${phase}`}>
      <div className="stop__window numeric">{formatWindow(stop.windowStart, stop.windowEnd)}</div>
      <div className="stop__who">
        <span className="stop__name">{name}</span>
        {stop.client.givenNameAr ? (
          <span className="stop__name-ar small muted" lang="ar" dir="rtl">
            {stop.client.givenNameAr}
          </span>
        ) : null}
      </div>
      {note ? (
        <div
          className={
            CRITICAL_STATUSES.includes(stop.status)
              ? 'stop__note small note--critical'
              : 'stop__note small muted'
          }
        >
          {note}
        </div>
      ) : null}
      {collapsed ? null : (
        <>
          {age ? <div className="stop__detail small muted numeric">{age}</div> : null}
          <div className="stop__detail small muted">{stop.serviceType.name}</div>
          <div className="stop__detail small muted">{describePlace(stop.location)}</div>
          {settled ? null : (
            <div className="stop__actions">
              {href ? (
                <a
                  className="button stop__action"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Navigate to ${name}`}
                >
                  Navigate
                </a>
              ) : null}
              <Button
                variant={phase === 'current' ? 'primary' : 'secondary'}
                className="stop__action"
                aria-label={`Check in ${name}`}
                onClick={() => onCheckIn(stop)}
              >
                Check in
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function TodayPage() {
  const { session, apiFetch, signOut } = useAuth();
  const navigate = useNavigate();

  const [now, setNow] = useState(() => new Date());
  const [date] = useState(() => practiceDate(new Date()));
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    void fetchDay(apiFetch, date).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [apiFetch, date, reloadToken]);

  const checkIn = useCallback(
    (stop: AppointmentRow) => {
      const mrn = stop.client.mrn;
      navigate(mrn ? `/today/check-in?mrn=${encodeURIComponent(mrn)}` : '/today/check-in');
    },
    [navigate],
  );

  const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
  // An owner or lead practitioner also has a desk on the admin side; offer the
  // way back so the two faces are one app, not two sign-ins (round 10).
  const hasConsole = session.status === 'signed-in' && homeFor(session.actor).startsWith('/admin');
  const stops = state.kind === 'ready' ? state.stops : [];
  const phases = stopPhases(
    stops.map((stop) => ({ windowStart: new Date(stop.windowStart), status: stop.status })),
    now,
  );

  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <h1>Today</h1>
        <div className="small muted">{roles}</div>
        <div className="small muted numeric">
          {DAY_FORMAT.format(new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`))}
        </div>

        {state.kind === 'loading' ? <Note>Loading your day.</Note> : null}
        {state.kind === 'error' ? (
          <div className="today__error">
            <Note tone="critical">{LOAD_ERROR}</Note>
            <Button
              className="today__wide"
              onClick={() => {
                setState({ kind: 'loading' });
                setReloadToken((token) => token + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {state.kind === 'ready' && stops.length === 0 ? (
          <Note>Nothing is booked for you today.</Note>
        ) : null}
        {stops.length > 0 ? (
          <ol className="stops">
            {stops.map((stop, index) => (
              <Stop
                key={stop.id}
                stop={stop}
                phase={phases[index] ?? 'later'}
                onCheckIn={checkIn}
              />
            ))}
          </ol>
        ) : null}

        <Note>
          Today needs a connection for now. Holding the day on the device, so it opens in a basement
          or a lift, is the next piece of work.
        </Note>
        {hasConsole ? (
          <Button className="today__wide" onClick={() => navigate('/admin/clients')}>
            Admin console
          </Button>
        ) : null}
        <Button className="today__wide" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    </div>
  );
}
