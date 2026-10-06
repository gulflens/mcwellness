import { useCallback, useState } from 'react';
import { MarketingResponse, WordingResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { PHRASES, useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * "Offers on your phone" — the marketing consent, on Agreements, given and
 * withdrawn by the adult themselves (the push memo's decision 1, answered "as
 * recommended" on 6 October 2026; docs/CONSENT/marketing.en.md and .ar.md).
 *
 * **The switch stands beside the wording.** "Read the wording" opens the
 * exact text in the language the person is reading, and the switch's own
 * label is that text's last paragraph — what the person says by turning it
 * on. Turning it on records a consent against that wording, by its id.
 *
 * **No is as easy as yes.** The switch turns off with one press, at once,
 * with no form and no reason asked: the wording promises "one press", and
 * an offer's own "stop" leads here (`#offers`).
 *
 * **Only for an adult to turn on.** A young person's own login is shown
 * nothing at all — the way the money screen is an absence for them. But
 * **the stop never vanishes**: while the switch is on, it is shown and turns
 * off, with or without a current wording and whether or not it would be
 * offered for turning on (PR 247's review, finding 2).
 */
export function OffersSwitch() {
  const words = useWords();
  const { apiFetch } = useAuth();
  const read = usePortalRead('/api/portal/marketing', MarketingResponse);
  const [state, setState] = useState<MarketingResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<'save' | 'link' | null>(null);

  const current = state ?? (read.kind === 'ready' ? read.data : null);
  const wording = current === null ? null : (current.wordings[words.locale] ?? null);

  const openWording = useCallback(() => {
    setFailed(null);
    void apiFetch(`/api/portal/marketing/wording/${words.locale}`)
      .then(async (res) => {
        if (!res.ok) {
          setFailed('link');
          return;
        }
        const { textUrl } = WordingResponse.parse(await res.json());
        if (window.open(textUrl, '_blank', 'noopener,noreferrer') === null) setFailed('link');
      })
      .catch(() => setFailed('link'));
  }, [apiFetch, words.locale]);

  const flip = useCallback(
    async (on: boolean) => {
      if (on && (wording === null || current === null || !current.offered)) return;
      setPending(true);
      setFailed(null);
      try {
        const res = await apiFetch(
          on ? '/api/portal/marketing' : '/api/portal/marketing/withdraw',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(on && wording !== null ? { wordingId: wording.id } : {}),
          },
        );
        if (res.ok) setState(MarketingResponse.parse(await res.json()));
        else setFailed('save');
      } catch {
        setFailed('save');
      } finally {
        setPending(false);
      }
    },
    [apiFetch, wording, current],
  );

  if (current === null) return null;
  const on = current.state === 'on';
  // Turning on needs the switch offered and a wording to stand beside.
  // Turning off needs neither: while offers can reach this person, the stop
  // is on the screen and works (PR 247's review, finding 2).
  const canTurnOn = current.offered && wording !== null;
  // Nothing to say to somebody who was never offered it — but a person who
  // has just stopped offers here is told so, not left with a blank.
  if (!on && !canTurnOn && state === null) return null;

  return (
    <section className="portal__section" id="offers" aria-labelledby="portal-offers">
      <h2 id="portal-offers">{words.t('offersHeading')}</h2>
      <p>{words.t('offersBody')}</p>
      {wording !== null ? (
        <p className="portal__actions">
          <button type="button" className="button button--quiet" onClick={openWording}>
            {words.t('readTheWording')}
          </button>
        </p>
      ) : !on && current.offered ? (
        <Note>{words.t('offersNoWording')}</Note>
      ) : null}
      {on || canTurnOn ? (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-busy={pending}
          aria-describedby="portal-offers-state"
          className="portal__switch"
          onClick={() => {
            if (!pending) void flip(!on);
          }}
        >
          <span>{words.t('offersSwitch')}</span>
        </button>
      ) : null}
      <p id="portal-offers-state" className="small muted">
        {on && current.since
          ? words.phrase(PHRASES.offersOnSince(words.date(current.since)))
          : current.state === 'off' && current.since
            ? words.phrase(PHRASES.offersOffSince(words.date(current.since)))
            : words.t('offersOff')}
      </p>
      {on ? <p className="small muted">{words.t('offersNeedNotifications')}</p> : null}
      <div role="status">
        {failed === 'save' ? <Note tone="critical">{words.t('saveFailed')}</Note> : null}
        {failed === 'link' ? <Note tone="critical">{words.t('linkFailed')}</Note> : null}
      </div>
    </section>
  );
}
