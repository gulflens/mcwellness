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
import { RoutingDayResponse, type DayLegRow } from '../../api/routing/schema';
import { StopBalanceResponse } from '../../api/billing/document-schema';
import { formatFils } from '../../admin/billing/money';
import { requestPersistentStorage } from '../session/outbox/store';
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
 *
 * **Offline, from piece eight.** The service worker caches this day's own
 * reads — the stops, the drives and the picture — so the app opens in a
 * basement car park with the day it last showed (docs/SPEC/
 * practitioner-phone.md sections 3.2 and 3.4). The check-in itself still needs
 * a bar of signal, which is where the practitioner is standing anyway.
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

/**
 * The drive line's own placeholder (docs/SPEC/practitioner-phone.md section
 * 5.4). Rendered from the first paint and replaced in place when the estimate
 * arrives, so a row never moves under a thumb reaching for Check in — the same
 * reason the money slot keeps its height.
 */
const NO_ESTIMATE = '\u2013 \u2013';

const MAP_UNAVAILABLE = "The map needs the practice's key.";

/**
 * The offline band (docs/DESIGN-BRIEF.md section 6.1: "a persistent, calm
 * band — not a red alert"). Working offline is normal.
 *
 * This screen used to carry one unconditional line, "Today needs a
 * connection", because there was no local store and the day could not be
 * shown without one. From piece eight the worker keeps this day's own reads,
 * so the day is there in a basement car park; what still needs a bar of signal
 * is the check-in at the door, which is where the practitioner is standing
 * anyway (docs/SPEC/practitioner-phone.md section 3.4). So the line says that,
 * and only when it is true.
 */
const OFFLINE_NOTE =
  'You are offline. This is the day as it last loaded; checking in needs a signal.';

/**
 * The two taps that put this app on an iPhone's home screen (section 3.3).
 * Safari has no install prompt and evicts a site's storage after seven days
 * unused unless it is there, so the practitioner is told once, calmly, and the
 * dismissal is remembered on the device.
 */
const INSTALL_KEY = 'mcwellness-install-note-dismissed';
const INSTALL_NOTE =
  'Add this to your home screen so it opens with no signal: press Share, then Add to Home Screen.';

/** "about 25 min \u00b7 18 km, estimate from traffic" (section 5.4). */
export function describeLeg(leg: DayLegRow | undefined): string {
  if (leg === undefined) return NO_ESTIMATE;
  const minutes = Math.max(1, Math.round(leg.seconds / 60));
  const km = leg.metres / 1000;
  const distance = km < 10 ? km.toFixed(1) : String(Math.round(km));
  const source = leg.source === 'traffic' ? 'estimate from traffic' : 'straight-line estimate';
  // Always the word estimate, and never a point time: neither implementation
  // knows when anybody will arrive (docs/SEAMS.md).
  return `about ${minutes} min \u00b7 ${distance} km, ${source}`;
}

/**
 * Whether this browser is Safari on an iPhone, running in a tab rather than
 * from the home screen. Deliberately narrow: the note is about two taps that
 * only exist there, and showing it anywhere else would be an instruction
 * nobody can follow.
 */
export function wantsInstallNote(nav: Navigator, standalone: boolean): boolean {
  if (standalone) return false;
  const agent = nav.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(agent);
  // Chrome and Firefox on iOS are Safari underneath but have no Share sheet
  // entry of their own for this, so the note names the tap only where it works.
  const safari = /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent);
  return iOS && safari;
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; stops: readonly DayStop[] };

/** The drives and the picture, or nothing at all when the route could not answer. */
type Drives = { legs: readonly DayLegRow[]; pictureUrl: string | null; mapAvailable: boolean };

/**
 * The day's picture, fetched rather than pointed at
 * (docs/SPEC/practitioner-phone.md section 5.3).
 *
 * A plain `<img src="/api/routing/day-picture…">` cannot work here: every
 * route below the fence authenticates on a bearer header and this API sets no
 * cookie (app/api/_middleware/request-context.ts), so the browser's own image
 * request would arrive with nothing on it and answer 401 — and a 401 is not
 * something the worker can cache either. So the bytes are asked for the way
 * every other read on this screen is asked for, through `apiFetch`, and shown
 * from an object URL.
 *
 * The object URL is revoked when the day changes and when the screen goes
 * away: a picture of several households' positions is personal data, and it
 * has no business outliving the screen that asked for it.
 */
function fetchPicture(apiFetch: ApiFetch, path: string): Promise<Blob | null> {
  return apiFetch(path)
    .then(async (res) => (res.ok ? res.blob() : null))
    .catch(() => null);
}

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

/**
 * The day's drives. A failure is not an error state: the stops still render
 * and every line keeps its placeholder, because a day sheet that refused to
 * open because an estimate could not be got would be worse than a day sheet
 * with a blank in it.
 */
function fetchDrives(apiFetch: ApiFetch, date: string): Promise<Drives | null> {
  return apiFetch(`/api/routing/day?date=${date}`)
    .then(async (res) => {
      if (!res.ok) return null;
      const parsed = RoutingDayResponse.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    })
    .catch(() => null);
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
  drive,
  onCheckIn,
}: {
  stop: DayStop;
  phase: StopPhase;
  /** Null while billing has not answered yet: the line appears when it does,
   * rather than a placeholder standing in for it. */
  balance: StopBalance | null;
  /**
   * The drive to this stop from the one before it, or undefined while the
   * estimate has not arrived. Null on the first stop of the day, where there
   * is no previous stop to have driven from — and the line is not rendered at
   * all there, rather than reserved for a leg that may never exist.
   */
  drive: { leg: DayLegRow | undefined } | null;
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
      {/* The slot is here from the first paint, empty, and keeps its height.
          Billing answers a moment after the day does, and a line appearing
          under a thumb pushes Navigate and Check in down by the height of it —
          so the tap that was aimed at one lands on the other, at a front door,
          which is the worst place in this app for a control to move (design
          review of this pull request). */}
      <div className="stop__money small numeric" aria-live="polite">
        {balance === null ? null : balance.kind === 'unavailable' ? (
          <span className="muted">Balance unavailable</span>
        ) : (
          <>
            {programme ? <span className="muted">{programme}</span> : null}
            <span className={balance.balance.outstandingFils > 0 ? 'stop__owed' : 'muted'}>
              {owedLine(balance.balance.outstandingFils)}
            </span>
          </>
        )}
      </div>
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
      {/* The drive from the stop before. Rendered from the first paint with its
          placeholder in it, so the row does not move when the estimate lands
          (docs/SPEC/practitioner-phone.md section 5.4). */}
      {drive === null ? null : (
        <p className="stop__drive small muted numeric" aria-live="polite">
          {describeLeg(drive.leg)}
        </p>
      )}
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
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [balances, setBalances] = useState<Record<string, StopBalance>>({});
  const [drives, setDrives] = useState<Drives | null>(null);
  // The day's picture as an object URL, or null while there is none to show.
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_KEY) === 'yes';
    } catch {
      // A browser with storage blocked shows the note every time, which is the
      // safe way round: the note is one calm line, and losing it would lose the
      // only place the two taps are named.
      return false;
    }
  });
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
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetchDay(apiFetch, date).then((next) => {
      if (live) setState(next);
    });
    void fetchDrives(apiFetch, date).then((next) => {
      if (live) setDrives(next);
    });
    return () => {
      live = false;
    };
  }, [apiFetch, date, reloadToken]);

  const pictureUrl = drives?.pictureUrl ?? null;
  useEffect(() => {
    // Nothing to fetch, and nothing to clear either: the run before this one
    // revoked its own object URL and emptied the slot on its way out.
    if (pictureUrl === null) return;
    let live = true;
    let objectUrl: string | null = null;
    void fetchPicture(apiFetch, pictureUrl).then((blob) => {
      if (!live || blob === null) return;
      objectUrl = URL.createObjectURL(blob);
      setMapUrl(objectUrl);
    });
    return () => {
      live = false;
      setMapUrl(null);
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [apiFetch, pictureUrl]);

  // Asked once, the first time this screen renders for a practitioner (section
  // 3.3). Best effort by definition: a browser may decline, and a decline is
  // not an error worth showing anybody.
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

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
  const legsByStop = new Map((drives?.legs ?? []).map((leg) => [leg.toStopId, leg]));
  const installNote =
    !installDismissed &&
    typeof navigator !== 'undefined' &&
    wantsInstallNote(
      navigator,
      typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
    );
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
        {online ? null : <Note>{OFFLINE_NOTE}</Note>}

        {installNote ? (
          <div className="today__install">
            <Note>{INSTALL_NOTE}</Note>
            <Button
              variant="quiet"
              onClick={() => {
                setInstallDismissed(true);
                try {
                  localStorage.setItem(INSTALL_KEY, 'yes');
                } catch {
                  // Nothing to do: the note simply comes back next time.
                }
              }}
            >
              Not now
            </Button>
          </div>
        ) : null}

        {/* The day, as a picture. Above the stops and sized to the column: it
            is for orientation, and the Navigate hand-off does the driving
            (section 5.3, decision 2). */}
        {stops.length > 0 && drives !== null ? (
          drives.pictureUrl === null ? (
            <p className="small muted">{MAP_UNAVAILABLE}</p>
          ) : mapUrl === null ? null : (
            <img
              className="today__map"
              src={mapUrl}
              alt={`A map of your ${stops.length === 1 ? 'stop' : `${stops.length} stops`} today`}
              width={640}
              height={400}
            />
          )
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
                // Between consecutive stops, one line (section 5.4). The leg
                // from the practitioner's home base to the first stop is
                // estimated and drawn on the picture, but no line is reserved
                // above the first card: a practice that records no home base
                // would leave a placeholder there for ever.
                drive={index === 0 ? null : { leg: legsByStop.get(stop.id) }}
                onCheckIn={checkIn}
              />
            ))}
          </ol>
        ) : null}

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
