import { useCallback, useEffect, useState } from 'react';
import { NotificationsResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { useWords } from './i18n';
import { deviceState, subscribeDevice, unsubscribeDevice, type DeviceState } from './pushDevice';
import { usePortalRead } from './usePortal';

/**
 * "Notifications on this phone" — the portal's step for the practice's
 * notifications (the push memo's decision 2; docs/SPEC/client-portal.md
 * section 3.11), on Home.
 *
 * **Shown only when it can be used.** Nothing at all on a deployment without
 * the practice's key pair, for a young person's own login, or while the answer
 * is loading or failed: an absence, never a button that cannot work.
 *
 * **The iPhone step in one sentence and three plain steps.** From Safari's own
 * tab an iPhone shows no notifications at all; once the portal is on the home
 * screen and opened from there, the button below works like anywhere else.
 *
 * **One press each way.** Turning on asks the phone (the browser's own
 * question, never pre-empted), subscribes, and hands the server this phone's
 * address; turning off lets the phone go and asks the server to forget it.
 */

type Phase = DeviceState | 'checking' | 'working' | 'failed';

export function NotificationsStep() {
  const words = useWords();
  const { apiFetch } = useAuth();
  const answer = usePortalRead('/api/portal/notifications', NotificationsResponse);
  const [phase, setPhase] = useState<Phase>('checking');
  const ready = answer.kind === 'ready' && answer.data.configured && answer.data.offered;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void deviceState()
      .catch((): DeviceState => 'unsupported')
      .then((state) => {
        if (live) setPhase(state);
      });
    return () => {
      live = false;
    };
  }, [ready]);

  const publicKey = answer.kind === 'ready' ? answer.data.publicKey : null;

  const turnOn = useCallback(async () => {
    if (publicKey === null) return;
    setPhase('working');
    try {
      const subscribed = await subscribeDevice(publicKey);
      if (subscribed === 'blocked' || subscribed === 'unsupported') {
        setPhase(subscribed);
        return;
      }
      const res = await apiFetch('/api/portal/notifications/subscriptions', {
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
        await apiFetch('/api/portal/notifications/subscriptions/remove', {
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

  if (!ready || phase === 'checking') return null;

  return (
    <section className="portal__section" aria-labelledby="portal-notifications">
      <h2 id="portal-notifications">{words.t('notificationsHeading')}</h2>
      <p>{words.t('notificationsBody')}</p>
      {phase === 'home-screen-first' ? (
        <>
          <p>{words.t('iphoneSentence')}</p>
          <ol className="portal__steps">
            <li>{words.t('iphoneStepShare')}</li>
            <li>{words.t('iphoneStepAdd')}</li>
            <li>{words.t('iphoneStepOpen')}</li>
          </ol>
        </>
      ) : phase === 'unsupported' ? (
        <Note>{words.t('notificationsUnsupported')}</Note>
      ) : phase === 'blocked' ? (
        <Note>{words.t('notificationsBlocked')}</Note>
      ) : phase === 'on' ? (
        <>
          <p>{words.t('notificationsOn')}</p>
          <p className="portal__actions">
            <button type="button" className="button button--quiet" onClick={() => void turnOff()}>
              {words.t('notificationsTurnOff')}
            </button>
          </p>
        </>
      ) : (
        <p className="portal__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={phase === 'working'}
            onClick={() => void turnOn()}
          >
            {words.t('notificationsTurnOn')}
          </button>
        </p>
      )}
      <div role="status">
        {phase === 'failed' ? <Note tone="critical">{words.t('notificationsFailed')}</Note> : null}
      </div>
    </section>
  );
}
