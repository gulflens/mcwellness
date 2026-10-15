import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { NotificationsResponse } from '../../api/portal/schema';
import {
  deviceState,
  subscribeDevice,
  unsubscribeDevice,
  type DeviceState,
} from '../../client/pushDevice';
import { useAuth } from '../auth/AuthContext';
import { Button, Note } from '../components/Controls';

/**
 * "Phone notifications" for a member of staff (the practice's list of 6
 * October 2026, item 7): this browser is told when a website enquiry lands —
 * "New website enquiry", and never who sent it (app/api/portal/push/events.ts).
 * English only, as the console is. Offered to the people who see Enquiries;
 * anybody else, or a deployment without the practice's key pair, reads one
 * plain sentence and no switch.
 *
 * The browser's half is the portal's (app/client/pushDevice.ts): the same
 * service worker, the same push service, the server's key. One press each
 * way, as the household's step is.
 */

type Phase = DeviceState | 'checking' | 'working' | 'failed' | 'not-offered';

export function PhoneNotificationsPage() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  const [answer, setAnswer] = useState<NotificationsResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch('/api/me/notifications');
        if (!res.ok) throw new Error('unread');
        const read = NotificationsResponse.parse(await res.json());
        if (!live) return;
        setAnswer(read);
        if (!read.configured || !read.offered) {
          setPhase('not-offered');
          return;
        }
        const state = await deviceState().catch((): DeviceState => 'unsupported');
        // The browser may hold a subscription the server does not count as
        // this person's (a household's, on a shared computer): only both
        // together are "on".
        if (live) setPhase(state === 'on' && read.devices === 0 ? 'off' : state);
      } catch {
        if (live) setPhase('failed');
      }
    })();
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const publicKey = answer?.publicKey ?? null;

  const turnOn = useCallback(async () => {
    if (publicKey === null) return;
    setPhase('working');
    try {
      const subscribed = await subscribeDevice(publicKey);
      if (subscribed === 'blocked' || subscribed === 'unsupported') {
        setPhase(subscribed);
        return;
      }
      const res = await apiFetch('/api/me/notifications/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscribed),
      });
      setPhase(res.ok ? 'on' : 'failed');
    } catch {
      setPhase('failed');
    }
  }, [apiFetch, publicKey]);

  const turnOff = useCallback(async () => {
    setPhase('working');
    try {
      const endpoint = await unsubscribeDevice();
      if (endpoint !== null) {
        await apiFetch('/api/me/notifications/subscriptions/remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      }
      setPhase('off');
    } catch {
      setPhase('failed');
    }
  }, [apiFetch]);

  return (
    <main className="plain">
      <h1>Phone notifications</h1>
      {phase === 'checking' ? null : phase === 'not-offered' ? (
        <p>
          {answer?.configured === false
            ? 'Phone notifications are not switched on for the practice yet.'
            : 'There are no notifications for your role yet.'}
        </p>
      ) : (
        <>
          <p>
            Turn this on to be told on this device when a website enquiry arrives. The notice says
            only that one has arrived, never who sent it.
          </p>
          {phase === 'home-screen-first' ? (
            <p>
              On an iPhone or iPad, add this app to the home screen from Safari’s Share menu, open
              it from there, and come back to this page.
            </p>
          ) : phase === 'unsupported' ? (
            <Note>This browser cannot receive notifications.</Note>
          ) : phase === 'blocked' ? (
            <Note>Notifications are blocked for this site in the browser’s settings.</Note>
          ) : phase === 'on' ? (
            <>
              <p>Notifications are on for this device.</p>
              <div className="team__actions">
                <Button variant="quiet" onClick={() => void turnOff()}>
                  Turn off on this device
                </Button>
              </div>
            </>
          ) : phase === 'failed' && answer === null ? null : (
            <div className="team__actions">
              <Button
                variant="primary"
                disabled={phase === 'working'}
                onClick={() => void turnOn()}
              >
                Turn on for this device
              </Button>
            </div>
          )}
        </>
      )}
      <div role="status">
        {phase === 'failed' ? (
          <Note tone="critical">That did not work. Try again in a moment.</Note>
        ) : null}
      </div>
      <div className="team__actions">
        <Button onClick={() => navigate(-1)}>Back</Button>
      </div>
    </main>
  );
}
