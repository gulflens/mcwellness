import { useCallback, useEffect, useState } from 'react';
import { LocationMeResponse } from '../../api/location/schema';
import { ConsentText } from '../../admin/clients/ConsentText';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { LOCATION_NOTICE } from './notice';
import './location.css';

/**
 * "Share my location while I work" (docs/SPEC/dispatch.md section 15, piece
 * twenty-five), on the practitioner's own day.
 *
 * **Consent first.** The switch is off until the person turns it on, here, in
 * their own app. The first time, turning it on shows the notice
 * (docs/CONSENT/staff/location.en.md, the words the practice approved, held
 * word for word in ./notice.ts and tested against the file) and asks for
 * "I agree"; after that the switch turns sharing on and off directly. Withdrawing the agreement is
 * one press, and deletes what is held.
 *
 * **A band the whole time it is on.** Whenever sharing is on, the band at the
 * top of the day says so and carries the way to stop. It is calm, never an
 * alert: sharing is something the person chose, not something wrong.
 *
 * **Sending.** While sharing is on, the shift is open and this app is in front
 * of the person, the phone's own position is read every two minutes and sent.
 * Nothing runs in the background: a hidden app sends nothing, and the browser
 * would not let it anyway. Turning the switch off stops the timer before the
 * request to say so has even left. The server decides again for every
 * position (consent, switch and shift), so nothing here is trusted to have
 * decided it — the state below is only what the screen shows.
 */

/** How often a position is sent while sharing: often enough to dispatch by, rarely enough not to drain a phone. */
export const POSITION_INTERVAL_MS = 120_000;

/** How often the screen asks again whether the shift has opened or closed. */
export const STATUS_INTERVAL_MS = 300_000;

const NOTICE_HEADING_ID = 'location-notice-heading';

const SAVE_FAILED = 'That did not go through. Check your connection, then try again.';
const NO_LOCATION =
  'Your phone did not let the app read its location, so nothing is being sent. Allow ' +
  'location for this app in your phone settings, or stop sharing.';

type Geolocation = Pick<globalThis.Geolocation, 'getCurrentPosition'>;

export type LocationSharingProps = {
  /** The browser's own geolocation unless a test says otherwise. */
  geolocation?: Geolocation | null;
};

function browserGeolocation(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function LocationSharing({ geolocation }: LocationSharingProps = {}) {
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<LocationMeResponse | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [locationRefused, setLocationRefused] = useState(false);
  const [visible, setVisible] = useState(documentVisible);
  const [reads, setReads] = useState(0);
  const geo = geolocation === undefined ? browserGeolocation() : geolocation;

  const reload = useCallback(() => setReads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/location/me')
      .then(async (res) => (res.ok ? LocationMeResponse.parse(await res.json()) : null))
      .then((next) => {
        if (live && next !== null) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [apiFetch, reads]);

  useEffect(() => {
    const tick = setInterval(reload, STATUS_INTERVAL_MS);
    const onVisibility = () => {
      setVisible(documentVisible());
      if (documentVisible()) reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);

  const sending = status !== null && status.sharingOn && status.shiftOpen && visible;

  // The sender. Its cleanup is what "off stops at once" rests on: the moment
  // sharing is off, the shift has closed or the app is hidden, the timer is
  // cleared and any reading still in flight is dropped rather than sent.
  useEffect(() => {
    if (!sending || geo === null) return;
    let live = true;
    const send = () => {
      geo.getCurrentPosition(
        (position) => {
          if (!live) return;
          setLocationRefused(false);
          void apiFetch('/api/location/positions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMetres: position.coords.accuracy,
            }),
          })
            .then((res) => {
              // Refused: the server has decided something the screen does not
              // know yet (the shift closed, the notice changed). Ask again.
              if (res.status === 409 && live) reload();
            })
            .catch(() => undefined);
        },
        () => {
          if (live) setLocationRefused(true);
        },
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
      );
    };
    send();
    const timer = setInterval(send, POSITION_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sending, geo, apiFetch, reload]);

  const write = useCallback(
    async (path: string, method: 'POST' | 'PUT', body: unknown): Promise<boolean> => {
      setBusy(true);
      setProblem(null);
      try {
        const res = await apiFetch(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) setProblem(SAVE_FAILED);
        return res.ok;
      } catch {
        setProblem(SAVE_FAILED);
        return false;
      } finally {
        setBusy(false);
        reload();
      }
    },
    [apiFetch, reload],
  );

  if (status === null || !status.eligible) return null;

  const agreed = status.consent !== null && status.consent.noticeVersion === status.noticeVersion;

  if (reading) {
    return (
      <section className="location-notice" aria-labelledby={NOTICE_HEADING_ID}>
        <h2 id={NOTICE_HEADING_ID}>Before you share your location</h2>
        <div className="location-notice__text">
          <ConsentText markdown={LOCATION_NOTICE} />
        </div>
        {problem ? <Note tone="critical">{problem}</Note> : null}
        <div className="location-notice__actions">
          {agreed ? null : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void write('/api/location/consent', 'POST', {
                  noticeVersion: status.noticeVersion,
                }).then((ok) => {
                  if (ok) setReading(false);
                });
              }}
            >
              I agree, share my location
            </Button>
          )}
          <Button variant="quiet" onClick={() => setReading(false)}>
            {agreed ? 'Back to my day' : 'Not now'}
          </Button>
        </div>
      </section>
    );
  }

  if (status.sharingOn) {
    return (
      <section className="location-band" aria-label="Location sharing">
        <p className="location-band__line" role="status">
          You are sharing your location with the office while you work.
        </p>
        <p className="small">
          {status.shiftOpen
            ? 'It is sent every two minutes while this app is open, and kept two days.'
            : 'Nothing is sent outside your working day.'}
        </p>
        {locationRefused ? <Note tone="attention">{NO_LOCATION}</Note> : null}
        {problem ? <Note tone="critical">{problem}</Note> : null}
        <Button
          className="location-band__stop"
          disabled={busy}
          onClick={() => {
            // Off here first, so the sender's cleanup runs on this render and
            // nothing more leaves the phone while the request is on its way.
            setStatus({ ...status, sharingOn: false });
            void write('/api/location/sharing', 'PUT', { on: false });
          }}
        >
          Stop sharing
        </Button>
      </section>
    );
  }

  return (
    <section className="location-share" aria-label="Location sharing">
      <button
        type="button"
        role="switch"
        aria-checked={false}
        aria-describedby="location-share-off"
        aria-busy={busy}
        className="location-switch"
        disabled={busy}
        onClick={() => {
          if (agreed) void write('/api/location/sharing', 'PUT', { on: true });
          else setReading(true);
        }}
      >
        <span>Share my location while I work</span>
      </button>
      <p id="location-share-off" className="small muted">
        Off. The office does not see where you are.
      </p>
      {problem ? <Note tone="critical">{problem}</Note> : null}
      {status.consent !== null ? (
        <div className="location-share__more">
          <Button variant="quiet" onClick={() => setReading(true)}>
            Read the notice
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void write('/api/location/consent/withdraw', 'POST', {})}
          >
            Withdraw my agreement
          </Button>
        </div>
      ) : null}
    </section>
  );
}
