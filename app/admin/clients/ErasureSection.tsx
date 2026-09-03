import { useCallback, useEffect, useState } from 'react';
import {
  ErasurePerformedResponse,
  ErasureRequestListResponse,
  type ClientRecordResponse,
  type ErasureRequestRecord,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { contactName } from './contactName';
import { DocumentLink } from './DocumentLink';

/**
 * Being forgotten, on the Overview tab (docs/SPEC/client-record.md section 8).
 *
 * Three states, and the screen is only ever in one of them.
 *
 *   * Nothing recorded. A quiet way to write down that a household has asked,
 *     with the reason and which contact asked, because the number to send the
 *     confirmation to is read from that contact at this moment and at no
 *     other: the erasure itself takes every phone on the record away.
 *   * Recorded, not yet done. What was asked and by whom, and — for the owner
 *     or an admin — the button, behind a step that says plainly what is about
 *     to happen and will not proceed without a reason. This is the sensitive
 *     action of section 9, so the reason is typed before it commits rather
 *     than explained afterwards.
 *   * Done. When, what went, what was kept, and the letter: to download, and
 *     to hand to WhatsApp as a drafted message somebody still has to press
 *     send on.
 *
 * **The number never enters a McWellness address.** The WhatsApp link is built
 * at the moment the button is pressed and handed straight to WhatsApp; it is
 * not rendered into the page in advance, not put in this app's own routes, and
 * not logged. That is the same discipline DocumentLink follows for a signed
 * link, for the same reason.
 */

const RECORD_ERROR = 'That erasure request could not be recorded. Try again.';
const PERFORM_ERROR = 'This record could not be erased. Try again.';
const PERFORM_REFUSALS: Record<string, string> = {
  already_erased: 'This record has already been erased.',
  already_performed: 'That request has already been carried out.',
  storage_unavailable:
    'The document store cannot be reached, so the confirmation letter cannot be written. Nothing has been erased.',
  reason_required: 'Say why this record is being erased.',
};

/** What the confirmation step repeats, in the order the erasure does it. */
const WHAT_HAPPENS = [
  'The name, date of birth and referral are removed from the record.',
  'Every contact loses their name, phone, email and WhatsApp preference, and any portal account is closed.',
  'Each address keeps only its emirate; the pin moves to the middle of that emirate and the Makani, directions, parking, gate and notes go.',
  'The description beside each goal is cleared.',
  'Every document filed against this client is deleted, and so are the files behind them.',
  'Invoices and credit notes are kept, as tax law requires, and nothing on them is changed.',
  'The record stays, in status erased, so the ledger and the audit trail still reconcile. Only the owner and the lead practitioner may open it afterwards, with a reason.',
];

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** The message the practice sends with the letter, in the household's own language. */
function draftMessage(record: ClientRecordResponse, performedAt: string): string {
  const day = formatDay(performedAt);
  return record.preferredLocale === 'ar'
    ? `مرحباً. معك McWellness. حُذف سجلك كما طلبت، بتاريخ ${day}. نرسل إليك التأكيد الخطي مع هذه الرسالة.`
    : `Hello. This is McWellness. Your record was erased, as you asked, on ${day}. The written confirmation is with this message.`;
}

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; requests: ErasureRequestRecord[] };

export function ErasureSection({
  record,
  reason: openingReason,
  mayAsk,
  mayErase,
  onChanged,
}: {
  record: ClientRecordResponse;
  /** The reason this drawer was opened with, when the record is already erased. */
  reason?: string;
  mayAsk: boolean;
  mayErase: boolean;
  onChanged: () => void;
}) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [asking, setAsking] = useState(false);
  const [askReason, setAskReason] = useState('');
  const [askContactId, setAskContactId] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [eraseReason, setEraseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [letterUrl, setLetterUrl] = useState<string | null>(null);
  const [whatsAppUrl, setWhatsAppUrl] = useState<string | null>(null);

  const headers = useCallback(
    (extra?: Record<string, string>): Record<string, string> => ({
      ...(openingReason ? { 'x-reason': openingReason } : {}),
      ...extra,
    }),
    [openingReason],
  );

  // Fetching and setting are kept apart so the effect below never calls
  // setState in its own body: it hands the answer to a callback, the way
  // DocumentsTab and useClientRecord do, and a drawer closed mid-flight sets
  // nothing.
  const fetchRequests = useCallback(async (): Promise<State> => {
    try {
      const res = await apiFetch(`/api/clients/${record.id}/erasure-requests`, {
        headers: headers(),
      });
      if (!res.ok) return { kind: 'error' };
      const body = ErasureRequestListResponse.parse(await res.json());
      return { kind: 'ready', requests: body.requests };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch, headers, record.id]);

  const load = useCallback(async (): Promise<void> => {
    setState(await fetchRequests());
  }, [fetchRequests]);

  useEffect(() => {
    let live = true;
    void fetchRequests().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [fetchRequests]);

  async function ask(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${record.id}/erasure-requests`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          reason: askReason.trim(),
          ...(askContactId ? { requestedByContactId: askContactId } : {}),
        }),
      });
      if (res.status !== 201) {
        setError(RECORD_ERROR);
        return;
      }
      setAsking(false);
      setAskReason('');
      setAskContactId('');
      await load();
    } catch {
      setError(RECORD_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function erase(requestId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/clients/${record.id}/erasure-requests/${requestId}/execute`,
        {
          method: 'POST',
          headers: headers({ 'x-reason': eraseReason.trim() }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError((body?.code && PERFORM_REFUSALS[body.code]) || PERFORM_ERROR);
        return;
      }
      const body = ErasurePerformedResponse.parse(await res.json());
      setLetterUrl(body.letter?.url ?? null);
      setConfirming(null);
      setEraseReason('');
      setState({ kind: 'ready', requests: [body.request] });
      // The header, the tabs and the status chip are all about to read
      // differently: this record is erased now.
      onChanged();
    } catch {
      setError(PERFORM_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function handToWhatsApp(request: ErasureRequestRecord): void {
    if (!request.notifyPhone || !request.performedAt) return;
    const digits = request.notifyPhone.replace(/\D/g, '');
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(draftMessage(record, request.performedAt))}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    // A blocked popup is null and silent; hand the link over rather than leave
    // a button that appears to do nothing (DocumentLink does the same).
    if (!opened) setWhatsAppUrl(url);
  }

  if (state.kind === 'loading') return <Note>Loading the erasure record.</Note>;
  if (state.kind === 'error') {
    return <Note tone="critical">The erasure record could not be loaded.</Note>;
  }

  const requests = state.requests;
  const performed = requests.find((request) => request.performedAt !== null) ?? null;
  const open = requests.find((request) => request.performedAt === null) ?? null;

  return (
    <section className="tab-section erasure">
      <h3 className="erasure__heading">Erasure</h3>

      {performed ? (
        <>
          <Note tone="attention">
            Erased on {formatDay(performed.performedAt as string)}. Nothing more can be filed
            against this record.
          </Note>
          {performed.summary ? (
            <dl className="record-facts">
              <div className="record-facts__row">
                <dt>Reason given</dt>
                <dd>{performed.reason}</dd>
              </div>
              <div className="record-facts__row">
                <dt>What went</dt>
                <dd>
                  <ul className="record-facts__list">
                    <li className="numeric">
                      {performed.summary.contactsAnonymised} contacts emptied
                    </li>
                    <li className="numeric">
                      {performed.summary.locationsReduced} addresses reduced to their emirate
                    </li>
                    <li className="numeric">
                      {performed.summary.documentsDeleted} documents deleted
                    </li>
                  </ul>
                </dd>
              </div>
              <div className="record-facts__row">
                <dt>What was kept</dt>
                <dd className="numeric">
                  {performed.summary.documentsKept} invoices and credit notes, as tax law requires
                </dd>
              </div>
              {performed.filesPending > 0 ? (
                <div className="record-facts__row">
                  <dt>Files still to remove</dt>
                  <dd className="numeric">
                    {performed.filesPending}. The store did not answer; they are removed when it
                    does.
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div className="drawer__actions">
            {letterUrl ? (
              <a
                className="button button--secondary"
                href={letterUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download the letter
              </a>
            ) : performed.letterDocumentId ? (
              <DocumentLink
                clientId={record.id}
                documentId={performed.letterDocumentId}
                reason={openingReason}
                label="Download the letter"
              />
            ) : null}
            {performed.notifyPhone ? (
              <Button variant="secondary" onClick={() => handToWhatsApp(performed)}>
                Send it by WhatsApp
              </Button>
            ) : null}
          </div>
          {performed.notifyPhone ? null : (
            <Note>
              No number was recorded with the request, so the letter has to be sent by hand.
            </Note>
          )}
          {whatsAppUrl ? (
            <p className="small" role="status">
              Your browser stopped WhatsApp opening.{' '}
              <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer">
                Open the message
              </a>
            </p>
          ) : null}
          <Note>
            The letter is a draft wording, pending the practice&apos;s lawyer
            {performed.letterVersion ? ` (version ${performed.letterVersion})` : ''}. Attach it to
            the message before sending.
          </Note>
        </>
      ) : null}

      {!performed && open ? (
        <>
          <dl className="record-facts">
            <div className="record-facts__row">
              <dt>Asked on</dt>
              <dd className="numeric">{formatDay(open.requestedAt)}</dd>
            </div>
            <div className="record-facts__row">
              <dt>Reason given</dt>
              <dd>{open.reason}</dd>
            </div>
            <div className="record-facts__row">
              <dt>Asked by</dt>
              <dd>
                {(() => {
                  const contact = record.contacts.find(
                    (one) => one.id === open.requestedByContactId,
                  );
                  if (!contact) return 'Not recorded';
                  return contactName(contact) || 'A contact on this record';
                })()}
              </dd>
            </div>
          </dl>

          {mayErase && confirming !== open.id ? (
            <div className="drawer__actions">
              <Button variant="primary" onClick={() => setConfirming(open.id)}>
                Erase this client
              </Button>
            </div>
          ) : null}

          {mayErase && confirming === open.id ? (
            <div className="tab-section erasure__confirm">
              <h4>This cannot be undone. Here is what happens.</h4>
              <ul className="record-facts__list">
                {WHAT_HAPPENS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Field
                id="erasure-reason"
                label="Reason"
                hint="Recorded against every entry this erasure writes."
                value={eraseReason}
                onChange={(event) => setEraseReason(event.target.value)}
              />
              <div className="drawer__actions">
                <Button
                  variant="primary"
                  disabled={busy || !eraseReason.trim()}
                  onClick={() => void erase(open.id)}
                >
                  {busy ? 'Erasing…' : 'Erase this client'}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {!mayErase ? <Note>Only the owner or an admin may carry out an erasure.</Note> : null}
        </>
      ) : null}

      {!performed && !open ? (
        <>
          {asking ? (
            <div className="drawer__form">
              <Field
                id="erasure-ask-reason"
                label="Why the household has asked"
                value={askReason}
                onChange={(event) => setAskReason(event.target.value)}
              />
              <div className="field">
                <label className="field__label" htmlFor="erasure-ask-contact">
                  Who asked
                </label>
                <select
                  id="erasure-ask-contact"
                  className="field__input"
                  value={askContactId}
                  onChange={(event) => setAskContactId(event.target.value)}
                >
                  <option value="">Not recorded</option>
                  {record.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contactName(contact) || contact.relationship}
                    </option>
                  ))}
                </select>
                <p className="field__hint small muted">
                  Their number is kept with the request, and is the only way the confirmation can be
                  sent afterwards.
                </p>
              </div>
              <div className="drawer__actions">
                <Button
                  variant="primary"
                  disabled={busy || !askReason.trim()}
                  onClick={() => void ask()}
                >
                  {busy ? 'Recording…' : 'Record the request'}
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : mayAsk ? (
            <div className="drawer__actions">
              <Button variant="quiet" onClick={() => setAsking(true)}>
                Record erasure request
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <Note tone="critical">{error}</Note> : null}
    </section>
  );
}
