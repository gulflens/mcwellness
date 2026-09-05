import { useCallback, useState } from 'react';
import {
  AgreementsResponse,
  REQUEST_NOTE_MAX,
  WordingResponse,
  type Agreement,
} from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { StatusChip, type StatusTone } from '../shell/components/StatusChip';
import { Sections } from './Layout';
import { useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * `/portal/agreements` — what each person on the record agreed to, and to what
 * exact words (docs/SPEC/client-portal.md section 3.5).
 *
 * **Nothing here withdraws or erases anything**, and the screen says so. Both
 * buttons open a short form and record a request; the practice then does the
 * thing on the record's own screens, where a withdrawal is a consent write with
 * a reason and an erasure is an irreversible act with a typed reason in front
 * of it. That separation is the whole design: the portal is where a family
 * speaks, not where something irreversible happens at eleven at night.
 *
 * **"Read the wording" opens the exact text that person was shown**, retired or
 * not — a consent points at the version it was given against, which is the
 * point of the pointer. Where that version has been superseded the row says so
 * and says the practice will ask them to read the new one.
 */

const TONE: Record<string, StatusTone> = {
  active: 'ok',
  withdrawn: 'neutral',
  expired: 'neutral',
  superseded: 'attention',
};

/** The one form on this screen: an optional note, and a button that sends. */
function AskForm({
  clientId,
  kind,
  consentId,
  onSent,
  onCancel,
}: {
  clientId: string;
  kind: 'consent_withdrawal' | 'erasure';
  consentId: string | null;
  onSent: () => void;
  onCancel: () => void;
}) {
  const words = useWords();
  const { apiFetch } = useAuth();
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');

  const send = useCallback(() => {
    setState('sending');
    void apiFetch('/api/portal/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId,
        kind,
        consentId,
        note: note.trim().length === 0 ? null : note,
      }),
    })
      .then((res) => {
        if (res.ok) onSent();
        else setState('failed');
      })
      .catch(() => setState('failed'));
  }, [apiFetch, clientId, kind, consentId, note, onSent]);

  const id = `portal-ask-${consentId ?? clientId}`;
  return (
    <div className="portal__form">
      <label className="field__label" htmlFor={id}>
        {words.t('askNote')}
      </label>
      <textarea
        id={id}
        className="field__input"
        rows={3}
        maxLength={REQUEST_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="small muted">{words.t('nothingWithdraws')}</p>
      <div className="portal__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={send}
          disabled={state === 'sending'}
        >
          {words.t('send')}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {words.t('cancel')}
        </button>
      </div>
      <div role="status">
        {state === 'failed' ? <Note tone="critical">{words.t('saveFailed')}</Note> : null}
      </div>
    </div>
  );
}

/** Opens the wording behind a consent, when the button is pressed and not before. */
function WordingButton({ consentId }: { consentId: string }) {
  const words = useWords();
  const { apiFetch } = useAuth();
  const [failed, setFailed] = useState(false);

  const open = useCallback(() => {
    setFailed(false);
    void apiFetch(`/api/portal/consents/${consentId}/wording`)
      .then(async (res) => {
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const { textUrl } = WordingResponse.parse(await res.json());
        if (window.open(textUrl, '_blank', 'noopener,noreferrer') === null) setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [apiFetch, consentId]);

  return (
    <>
      <button type="button" className="button button--quiet" onClick={open}>
        {words.t('readTheWording')}
      </button>
      {failed ? <span className="portal__row-note small">{words.t('linkFailed')}</span> : null}
    </>
  );
}

function AgreementRow({
  agreement,
  asking,
  onAsk,
  onCancel,
  onSent,
}: {
  agreement: Agreement;
  asking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onSent: () => void;
}) {
  const words = useWords();
  return (
    <div className="portal__row">
      <span>{words.purpose(agreement.purpose)}</span>
      <StatusChip
        label={words.consentStatus(agreement.status)}
        tone={TONE[agreement.status] ?? 'neutral'}
      />
      <span className="numeric small">
        {agreement.withdrawnAt
          ? `${words.t('withdrawn')} ${words.date(agreement.withdrawnAt)}`
          : `${words.t('given')} ${words.date(agreement.givenAt)}`}
      </span>
      <span className="small muted">{words.relationship(agreement.givenByRelationship)}</span>
      {agreement.wordingDocumentId ? <WordingButton consentId={agreement.id} /> : null}

      {agreement.newerWordingExists ? (
        <span className="portal__row-note small">{words.t('newerWording')}</span>
      ) : null}

      {agreement.status === 'active' ? (
        <span className="portal__row-note">
          {agreement.requestedWithdrawal ? (
            <Note>{words.t('askedAlready')}</Note>
          ) : asking ? (
            <AskForm
              clientId={agreement.clientId}
              kind="consent_withdrawal"
              consentId={agreement.id}
              onSent={onSent}
              onCancel={onCancel}
            />
          ) : (
            <button type="button" className="button button--secondary" onClick={onAsk}>
              {words.t('askToWithdraw')}
            </button>
          )}
        </span>
      ) : null}
    </div>
  );
}

export function AgreementsScreen() {
  const words = useWords();
  const agreements = usePortalRead('/api/portal/agreements', AgreementsResponse);
  // Which ask is open, by the consent's id or, for an erasure, the client's.
  const [asking, setAsking] = useState<string | null>(null);

  if (agreements.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (agreements.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (agreements.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const { clients, agreements: rows, erasureRequested } = agreements.data;
  const sent = () => {
    setAsking(null);
    agreements.reload();
  };

  return (
    <section className="portal__section">
      <h1>{words.t('agreements')}</h1>
      {rows.length === 0 ? <Note>{words.t('noAgreements')}</Note> : null}
      <Sections
        clients={clients}
        render={(client) => {
          const mine = rows.filter((row) => row.clientId === client.id);
          const askedErasure = erasureRequested.includes(client.id);
          return (
            <>
              <div className="portal__list">
                {mine.map((agreement) => (
                  <AgreementRow
                    key={agreement.id}
                    agreement={agreement}
                    asking={asking === agreement.id}
                    onAsk={() => setAsking(agreement.id)}
                    onCancel={() => setAsking(null)}
                    onSent={sent}
                  />
                ))}
              </div>
              <div className="portal__actions">
                {askedErasure ? (
                  <Note>{words.t('askedAlready')}</Note>
                ) : asking === client.id ? (
                  <AskForm
                    clientId={client.id}
                    kind="erasure"
                    consentId={null}
                    onSent={sent}
                    onCancel={() => setAsking(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setAsking(client.id)}
                  >
                    {words.t('askForErasure')}
                  </button>
                )}
              </div>
            </>
          );
        }}
      />
    </section>
  );
}
