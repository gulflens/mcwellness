import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  directionsUrl,
  formatArrivalWindow,
  isSettled,
  navigationTarget,
  practiceDate,
  stopPhases,
  PRACTICE_TIME_ZONE,
  type AppointmentStatus,
  type StopPhase,
} from '@domain/scheduling';
import { DayStopListResponse, type DayStop } from '../../api/appointments/schema';
import { StopBalanceResponse } from '../../api/billing/document-schema';
import { formatFils } from '../../admin/billing/money';
import { useAuth, type ApiFetch } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { ChevronIcon } from '../../shell/components/Icons';
import { describeRoles, homeFor } from '../../shell/routing';
import './today.css';

/**
 * The practitioner's day (docs/SPEC/scheduling-manual.md section 5.1). One
 * column on the dark ground, one stop after another: the arrival window, who
 * is behind the door, where it is, the drive, and the way into check-in. The
 * stop being delivered is emphasised; the ones behind it fold away, and open
 * again in full if the practitioner wants them.
 *
 * Deliberately not here:
 *
 * - **Brief.** Section 5.1 asks for one, and it needs the client brief the
 *   client-record stream owns (protocol summary, last session notes, access
 *   notes, contacts). Nothing on this screen invents a shortcut to it.
 * - **Offline.** Section 5.1 also asks this screen to render from the last
 *   sync, and section 11 makes that a condition of the stage. There is no
 *   local store yet, so the screen states the plain fact and no more.
 *
 * Nothing here shows an identity number or a clinical note (section 11), and
 * the family name never reaches the browser at all: the wire carries a single
 * initial (app/api/appointments/schema.ts's `DayStop`).
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
 * Four of these are covered even though the own scope does not send them:
 * app/api/appointments/list.ts holds a day sheet to the visits that are
 * actually stops, so a proposed, cancelled, late-cancelled or rescheduled
 * appointment never reaches this component. They stay named anyway — a map
 * with a hole in it is a worse thing to hand a component than a map with a
 * branch that rarely fires, and the day the day sheet widens, the words are
 * already written.
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

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

// Asia/Dubai carries no daylight-saving change, so the day being shown always
// starts at this exact offset from UTC.
const PRACTICE_UTC_OFFSET = '+04:00';

// A day sheet left open goes stale: the emphasised stop is the one whose
// window has opened, windows open while nobody touches the screen, and a day
// eventually turns into the next one. A minute is fine for a 45-minute
// window, and it is a re-render, not motion.
const CLOCK_TICK_MS = 60_000;

const LOAD_ERROR = 'Your day could not be loaded. Check your connection, then try again.';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; stops: readonly DayStop[] };

/**
 * The window, in the practice's zone and in that order in both languages:
 * `formatArrivalWindow` isolates the range so an Arabic name beside it cannot
 * reverse the two clock times (domain/scheduling/window.ts). The admin
 * console's own screens call the same function through
 * app/admin/schedule/windows.ts.
 */
function formatWindow(windowStart: string, windowEnd: string): string {
  return formatArrivalWindow(new Date(windowStart), new Date(windowEnd), PRACTICE_TIME_ZONE);
}

/**
 * First name and family initial (section 5.1). The initial is computed in SQL
 * and is all the browser is given, so this only decides the punctuation — and
 * drops it entirely for a client with no family name on file.
 */
function shortName(givenName: string, familyInitial: string | null): string {
  const initial = (familyInitial ?? '').trim();
  return initial ? `${givenName} ${initial}.` : givenName;
}

function describeAge(age: number | null): string | null {
  if (age === null) {
    return null;
  }
  return age === 1 ? '1 year old' : `${age} years old`;
}

function describePlace(location: DayStop['location']): string {
  const label = LOCATION_LABELS[location.label] ?? location.label;
  const emirate = EMIRATES[location.emirate] ?? location.emirate;
  return `${label}, ${emirate}`;
}

/** The Google Maps hand-off for a stop. */
function navigateHref(location: DayStop['location']): string {
  // Coordinates only, never a name or an address: docs/COMPLIANCE/approved-vendors.md
  // holds Google Maps to exactly that, and the app sends no referrer either.
  return directionsUrl(
    navigationTarget({
      entrancePoint: location.entrancePoint,
      parkingPoint: location.parkingPoint,
    }),
  );
}

/**
 * What the practitioner is told about the money at the door
 * (docs/CHANGE-REQUESTS/billing-03.md item 5, docs/SPEC/billing.md
 * section 1: "Session 3 of 15" is the thing the ledger exists to be able to
 * say, and the person who needs it is the one driving there).
 *
 * `unavailable` is not an error state. Billing may decline for a perfectly
 * correct reason — a client outside this practitioner's own schedule window
 * answers 404 rather than an empty balance — and a red alert at somebody's
 * front door about a figure the visit does not depend on would be the wrong
 * shape of noise. It says one calm line and the stop stands.
 *
 * **The narrow route, deliberately.** This reads
 * `GET /api/billing/clients/:clientId/stop-balance` and never the console's
 * `/balance`. The two have the same permission and the same audit row; what
 * differs is the size of the answer. The full one carries the practice's
 * commercial position — every purchase with its net, its VAT and its list
 * price, the reason somebody extended one, invoice ids, recognised and
 * deferred figures — and none of that has any business in a phone standing at
 * a family's front door. The narrow one answers per service a code and three
 * counts, plus one outstanding figure, which is the whole of what this card
 * says (compliance review of this pull request; billing built the route for
 * it).
 */
type StopBalance = { kind: 'unavailable' } | { kind: 'ready'; balance: StopBalanceResponse };

/**
 * Which session of the programme this one is.
 *
 * Counted against the stop's own service, because a household on a bundle
 * holds sessions of several kinds and "3 of 15" means three of the fifteen
 * neurofeedback sessions, not three of everything they bought. A visit still
 * to be delivered is the one after the last delivered; a visit already
 * delivered is already counted, so it is that count itself. Null when the
 * household holds no bundle for this service at all — a single visit is not
 * session one of one, it is simply a visit.
 */
function sessionOfProgramme(
  balance: StopBalanceResponse,
  serviceTypeCode: string,
  settled: boolean,
): string | null {
  // Matched by code: the stop-card route answers by what a service is, never
  // by an id (app/api/billing/document-schema.ts's StopServiceBalance).
  const service = balance.services.find((row) => row.serviceTypeCode === serviceTypeCode);
  if (!service || service.purchased === 0) {
    return null;
  }
  const ordinal = settled ? service.delivered : service.delivered + 1;
  return `Session ${Math.min(ordinal, service.purchased)} of ${service.purchased}`;
}

/**
 * What the household owes, in words a person can act on at a door. The
 * currency is named once, beside the figure, rather than assumed
 * (app/admin/billing/money.ts writes the figure bare).
 */
function owedLine(outstandingFils: number): string {
  if (outstandingFils > 0) {
    return `AED ${formatFils(outstandingFils)} owed`;
  }
  if (outstandingFils < 0) {
    return `AED ${formatFils(-outstandingFils)} in credit`;
  }
  return 'Nothing owed';
}

function fetchDay(apiFetch: ApiFetch, date: string): Promise<State> {
  return apiFetch(`/api/appointments?date=${date}&scope=own`)
    .then(async (res) => {
      if (!res.ok) return { kind: 'error' } as const;
      const parsed = DayStopListResponse.safeParse(await res.json());
      if (!parsed.success) return { kind: 'error' } as const;
      return { kind: 'ready', stops: parsed.data.appointments } as const;
    })
    .catch(() => ({ kind: 'error' }) as const);
}

function Stop({
  stop,
  phase,
  balance,
  onCheckIn,
}: {
  stop: DayStop;
  phase: StopPhase;
  /** Null while billing has not answered yet: the line appears when it does,
   * rather than a placeholder standing in for it. */
  balance: StopBalance | null;
  onCheckIn: (stop: DayStop) => void;
}) {
  const name = shortName(stop.client.givenName, stop.client.familyInitial);
  const arabicName = stop.client.givenNameAr
    ? shortName(stop.client.givenNameAr, stop.client.familyInitialAr)
    : null;
  const age = describeAge(stop.client.age);
  const note = STOP_NOTES[stop.status];

  // The actions turn on whether the visit is finished, never on where the
  // practitioner has got to in the day. A confirmed visit nobody closed is
  // still a visit somebody owes: it folds away, but it keeps its buttons.
  const settled = isSettled(stop.status);

  const head = (
    <>
      <span className="stop__window numeric">{formatWindow(stop.windowStart, stop.windowEnd)}</span>
      <span className="stop__name">{name}</span>
      {arabicName ? (
        <span className="stop__name-ar small muted" lang="ar" dir="rtl">
          {arabicName}
        </span>
      ) : null}
      {note ? (
        <span
          className={
            CRITICAL_STATUSES.includes(stop.status)
              ? 'stop__note small note--critical'
              : 'stop__note small muted'
          }
        >
          {note}
        </span>
      ) : null}
    </>
  );

  const programme =
    balance?.kind === 'ready'
      ? sessionOfProgramme(balance.balance, stop.serviceType.code, settled)
      : null;

  const detail = (
    <div className="stop__detail">
      {age ? <div className="small muted numeric">{age}</div> : null}
      <div className="small muted">{stop.serviceType.name}</div>
      <div className="small muted">{describePlace(stop.location)}</div>
      {balance === null ? null : balance.kind === 'unavailable' ? (
        <div className="small muted">Balance unavailable</div>
      ) : (
        <div className="stop__money small numeric">
          {programme ? <span className="muted">{programme}</span> : null}
          <span className={balance.balance.outstandingFils > 0 ? 'stop__owed' : 'muted'}>
            {owedLine(balance.balance.outstandingFils)}
          </span>
        </div>
      )}
      {settled ? null : (
        <div className="stop__actions">
          {/* The visible word is one of several identical ones down the
              column, and it leaves the app, so the announced name says whose
              door and where the tap goes. An aria-label rather than a
              visually-hidden span: the accessible-name algorithm concatenates
              child text without inserting separators, so the span form is
              announced as one run-together word by anything that follows it
              literally. The visible text stays a prefix of the label, so
              voice control still hears "Navigate". */}
          <a
            className="button stop__action"
            href={navigateHref(stop.location)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Navigate to ${name}, opens Google Maps in a new tab`}
          >
            Navigate
          </a>
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
    </div>
  );

  return (
    <li className={`stop stop--${phase}`} aria-current={phase === 'current' ? 'step' : undefined}>
      {phase === 'past' ? (
        // A real disclosure, not a stub: a stop behind the practitioner folds
        // down to when it was and who it was, and opens again in full — the
        // drive and the check-in included, when the visit is still open.
        <details className="stop__fold">
          <summary className="stop__summary">
            {head}
            <ChevronIcon className="stop__chevron" />
          </summary>
          {detail}
        </details>
      ) : (
        <>
          {head}
          {detail}
        </>
      )}
    </li>
  );
}

export function TodayPage() {
  const { session, apiFetch, signOut } = useAuth();
  const navigate = useNavigate();

  const [now, setNow] = useState(() => new Date());
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [balances, setBalances] = useState<Record<string, StopBalance>>({});
  // Which day each household's balance was last asked for. A ref rather than
  // state, because it decides whether to make a request and must not itself
  // cause a render: one fetch per household per day, so refreshing the day
  // sheet does not re-ask a question already answered, and a new day does.
  //
  // An entry is removed again when the request does not produce an answer, so
  // a failure is asked again on the next reload rather than remembered as
  // though it had been answered.
  const askedOn = useRef(new Map<string, string>());
  // Whether this screen is still on screen at all. Deliberately not a flag per
  // effect run: an answer is keyed by household and day, both of which are
  // checked before it is asked for, so it is just as good whichever run of the
  // effect asked for it. Dropping it because the effect re-ran — which happens
  // on every reload of the day — lost the answer for good, since the request
  // had already been recorded as made (compliance review of this pull request).
  const onScreen = useRef(true);

  // The day is derived from the clock, never frozen at mount: a screen left
  // open overnight asks for the new day, not yesterday's.
  const date = practiceDate(now);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    // Coming back to the screen is the moment a coordinator's change is most
    // likely to have happened since it was last read, so it is also the moment
    // to ask again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
        setReloadToken((token) => token + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  // The money at the door, one household at a time. Every request is its own,
  // so a household billing declines does not take the others down with it,
  // and no stop waits on another stop's answer.
  useEffect(
    () => () => {
      onScreen.current = false;
    },
    [],
  );

  useEffect(() => {
    if (state.kind !== 'ready') {
      return;
    }
    for (const stop of state.stops) {
      const clientId = stop.clientId;
      if (askedOn.current.get(clientId) === date) {
        continue;
      }
      askedOn.current.set(clientId, date);
      void apiFetch(`/api/billing/clients/${clientId}/stop-balance`)
        .then(async (res) => {
          if (!onScreen.current) return;
          if (!res.ok) {
            // A refusal is an answer, and stays remembered: asking again on
            // every reload would be a request per reload for a household this
            // practitioner is not entitled to ask about.
            setBalances((all) => ({ ...all, [clientId]: { kind: 'unavailable' } }));
            return;
          }
          const parsed = StopBalanceResponse.safeParse(await res.json());
          setBalances((all) => ({
            ...all,
            [clientId]: parsed.success
              ? { kind: 'ready', balance: parsed.data }
              : { kind: 'unavailable' },
          }));
        })
        .catch(() => {
          // A connection that failed is not an answer. Forget that it was
          // asked, so the next reload asks again.
          askedOn.current.delete(clientId);
          if (onScreen.current) {
            setBalances((all) => ({ ...all, [clientId]: { kind: 'unavailable' } }));
          }
        });
    }
  }, [apiFetch, date, state]);

  const checkIn = useCallback(
    (stop: DayStop) => {
      // Router state, never the address: a record number is personal data and
      // .claude/rules/ui.md keeps it out of paths and query strings. It is
      // carried in memory, so it never lands in history, a bookmark, a shared
      // link or a server log.
      navigate('/today/check-in', { state: { record: stop.client.mrn } });
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
        {/* Title, who is signed in and which day, as one block: three items on
            the column's own 24px rhythm pushed the first window off a small
            phone before anything had been read. */}
        <header className="today__header">
          <h1>Today</h1>
          <div className="small muted">{roles}</div>
          <div className="small muted numeric">
            {DAY_FORMAT.format(new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`))}
          </div>
        </header>

        {state.kind === 'loading' ? <Note>Loading your day.</Note> : null}
        {state.kind === 'error' ? (
          <div className="today__error">
            <Note tone="critical">{LOAD_ERROR}</Note>
            <Button
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
          <ol className="stops" aria-label="Your stops today">
            {stops.map((stop, index) => (
              <Stop
                key={stop.id}
                stop={stop}
                phase={phases[index] ?? 'later'}
                balance={balances[stop.clientId] ?? null}
                onCheckIn={checkIn}
              />
            ))}
          </ol>
        ) : null}

        <Note>Today needs a connection.</Note>

        {/* The account controls, set apart from the day by a rule and sized to
            themselves: full-width slabs here would read as two more actions of
            the same weight as checking a client in, which they are not. */}
        <div className="today__account">
          {hasConsole ? (
            <Button onClick={() => navigate('/admin/clients')}>Admin console</Button>
          ) : null}
          <Button variant="quiet" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}
