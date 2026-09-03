import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ErasurePerformedResponse,
  ErasureRequestListResponse,
  type ClientRecordResponse,
  type ErasureRequestRecord,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { Textarea } from './FormAtoms';
import { contactName } from './contactName';
import { DocumentLink } from './DocumentLink';

/**
 * Being forgotten, on the Overview tab (docs/SPEC/client-record.md section 8).
 *
 * Three states, and the screen is only ever in one of them.
 *
 *   * Nothing recorded. A quiet way to write down that a household has asked,
 *     with the reason and which contact asked. Which contact is not optional
 *     bookkeeping: their number is read at that moment and at no other, and it
 *     is the only way the confirmation can be sent afterwards, so the form
 *     makes somebody say either who asked or that nobody on the record did.
 *   * Recorded, not yet done. What was asked and by whom, and — for the owner
 *     or an admin — the button, behind a step that names the record it is
 *     about, says plainly what is about to happen, and will not proceed
 *     without a typed reason. This is the sensitive action of section 9, so
 *     the reason is typed before it commits rather than explained afterwards.
 *   * Done. When, who by, what went, what was kept, and the letter: to
 *     download and to hand to WhatsApp as a drafted message somebody still has
 *     to press send on.
 *
 * **After the act this panel stays put and nothing is refetched.** An admin
 * may perform an erasure and may not open an erased record (section 2), so a
 * refetch as the person who just pressed the button answers 403 and the drawer
 * would say "the record could not be loaded" the moment an irreversible act
 * succeeded. The response carries everything this panel needs, so it renders
 * from that and tells the drawer what happened instead of asking the server
 * again — and hands the drawer the reason it was erased with, so an owner or a
 * lead practitioner is not bounced to the reason prompt for a record they are
 * standing in front of.
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

/**
 * What the confirmation step repeats, in the order the erasure does it, and
 * saying the same as the letter the household receives
 * (docs/CONSENT/erasure-letter/).
 */
const WHAT_HAPPENS = [
  'The name, date of birth and referral are removed from the record.',
  'Every contact loses their name, phone, email and WhatsApp preference, and any portal account is closed.',
  'Each address keeps only its emirate; the pin moves to the middle of that emirate and the Makani, directions, parking, gate and notes go.',
  'The description beside each goal is cleared.',
  'The visit record loses where the practitioner checked in and out, the observations written afterwards, the access notes from the drive, and anything written in words.',
  'The measurements stay, with nobody attached to them: the ratings, the readings and their quality scores.',
  'Every document filed against this client is deleted, and so are the files behind them.',
  'Invoices and receipts are kept for five years, as tax law requires — the records and the copies issued to the household — and nothing on them is changed.',
  "The practice's own log keeps its five years, holding the names of the fields that were cleared and none of the values.",
  'The record stays, in status erased, so the ledger and the audit trail still reconcile.',
];

/** One line, pluralised, or nothing at all when there was nothing of that kind. */
function counted(n: number, one: string, many: string): ReactNode {
  if (n === 0) return null;
  return (
    <li className="numeric" key={one}>
      {n} {n === 1 ? one : many}
    </li>
  );
}

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

/** The letter's own file name, so a person can find it again in their downloads. */
function letterFileName(record: ClientRecordResponse): string {
  return `erasure-letter-${record.mrn}.md`;
}

/**
 * The heading of a step that has just opened, which takes focus as it appears
 * and announces itself. The same atom ConsentTab uses, and for the same
 * reason: a panel that opens below the fold while focus stays on the button
 * that opened it is a button that appears to do nothing.
 */
function StepHeading({ children }: { children: ReactNode }) {
  return (
    <h4
      className="drawer__section"
      tabIndex={-1}
      role="status"
      ref={(node) => {
        node?.focus();
      }}
    >
      {children}
    </h4>
  );
}

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; requests: ErasureRequestRecord[] };

export function ErasureSection({
  record,
  reason: openingReason,
  mayAsk,
  mayErase,
  onErased,
}: {
  record: ClientRecordResponse;
  /** The reason this drawer was opened with, when the record is already erased. */
  reason?: string;
  mayAsk: boolean;
  mayErase: boolean;
  /**
   * Called once the record has been erased, with the reason it was erased
   * with. The drawer takes both: the status it shows, and the reason its own
   * routes now ask for. Nothing is refetched — see the note above.
   */
  onErased?: (reason: string) => void;
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
  const [sent, setSent] = useState(false);
  // Set once this panel has erased the record itself. From that moment it
  // renders what the act answered and asks the server nothing further: the
  // person who pressed the button may be an admin, and an admin may not read
  // an erased record back (docs/SPEC/client-record.md section 2). Without it
  // the drawer taking the erasure reason — which it does, so an owner is not
  // bounced to the reason prompt — would change this component's headers and
  // send it straight back for a list it is no longer allowed to have.
  const [settled, setSettled] = useState(false);

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
    if (settled) return;
    let live = true;
    void fetchRequests().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [fetchRequests, settled]);

  async function ask(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${record.id}/erasure-requests`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          reason: askReason.trim(),
          ...(askContactId && askContactId !== 'none'
            ? { requestedByContactId: askContactId }
            : {}),
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
    const reason = eraseReason.trim();
    try {
      const res = await apiFetch(
        `/api/clients/${record.id}/erasure-requests/${requestId}/execute`,
        {
          method: 'POST',
          // The act carries no body of its own — the reason is a header, never
          // a query string — but every POST says what it is sending
          // (app/api/_middleware/security.ts answers 415 otherwise).
          headers: headers({ 'content-type': 'application/json', 'x-reason': reason }),
          body: '{}',
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
      // Straight from the answer, and nothing is asked of the server again:
      // this person may no longer be allowed to read what they have just done.
      setState({ kind: 'ready', requests: [body.request] });
      setSettled(true);
      onErased?.(reason);
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
    // Saying the letter has gone starts the clock on the number it went to:
    // the sweep clears it once the files are confirmed gone as well. Nothing
    // depends on the answer — the message is already open in front of them.
    setSent(true);
    void apiFetch(`/api/clients/${record.id}/erasure-requests/${request.id}/letter-sent`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: '{}',
    }).catch(() => undefined);
  }

  if (state.kind === 'loading') return <Note>Loading the erasure record.</Note>;
  if (state.kind === 'error') {
    return <Note tone="critical">The erasure record could not be loaded.</Note>;
  }

  const requests = state.requests;
  const performed = requests.find((request) => request.performedAt !== null) ?? null;
  const open = requests.find((request) => request.performedAt === null) ?? null;
  const askedBy = (request: ErasureRequestRecord): string => {
    const contact = record.contacts.find((one) => one.id === request.requestedByContactId);
    if (!contact) return 'Not recorded';
    return contactName(contact) || 'A contact on this record';
  };

  return (
    <section className="tab-section erasure">
      <h3 className="erasure__heading">Erasure</h3>

      {performed ? (
        <>
          <Note tone="attention">
            Erased on {formatDay(performed.performedAt as string)}
            {performed.performedByName ? ` by ${performed.performedByName}` : ''}. Nothing more can
            be filed against this record.
          </Note>
          <dl className="record-facts">
            <div className="record-facts__row">
              <dt>Asked on</dt>
              <dd className="numeric">{formatDay(performed.requestedAt)}</dd>
            </div>
            <div className="record-facts__row">
              <dt>Asked by</dt>
              <dd>{askedBy(performed)}</dd>
            </div>
            <div className="record-facts__row">
              <dt>Reason for the request</dt>
              <dd>{performed.reason}</dd>
            </div>
            {performed.performedReason ? (
              <div className="record-facts__row">
                <dt>Reason given when erasing</dt>
                <dd>{performed.performedReason}</dd>
              </div>
            ) : null}
            {performed.summary ? (
              <>
                <div className="record-facts__row">
                  <dt>What went</dt>
                  <dd>
                    <ul className="record-facts__list">
                      {counted(
                        performed.summary.contactsAnonymised,
                        'contact emptied',
                        'contacts emptied',
                      )}
                      {counted(
                        performed.summary.portalAccountsArchived,
                        'portal account closed',
                        'portal accounts closed',
                      )}
                      {counted(
                        performed.summary.locationsReduced,
                        'address reduced to its emirate',
                        'addresses reduced to their emirate',
                      )}
                      {counted(performed.summary.goalsCleared, 'goal cleared', 'goals cleared')}
                      {counted(
                        performed.summary.consentsUnlinked,
                        'consent unlinked',
                        'consents unlinked',
                      )}
                      {counted(
                        performed.summary.sessionsCleared,
                        'visit cleared',
                        'visits cleared',
                      )}
                      {counted(
                        performed.summary.sessionEventsCleared,
                        'visit event cleared',
                        'visit events cleared',
                      )}
                      {counted(
                        performed.summary.visitActualsCleared,
                        'set of access notes cleared',
                        'sets of access notes cleared',
                      )}
                      {counted(
                        performed.summary.paymentsCleared,
                        'payment reference cleared',
                        'payment references cleared',
                      )}
                      {counted(
                        performed.summary.documentsDeleted,
                        'document deleted',
                        'documents deleted',
                      )}
                    </ul>
                  </dd>
                </div>
                <div className="record-facts__row">
                  <dt>What was kept</dt>
                  <dd>
                    <ul className="record-facts__list">
                      <li className="numeric">
                        {performed.summary.documentsKept}{' '}
                        {performed.summary.documentsKept === 1
                          ? 'invoice or credit note, as tax law requires'
                          : 'invoices and credit notes, as tax law requires'}
                      </li>
                      <li>The measurements, with nobody attached to them</li>
                    </ul>
                  </dd>
                </div>
              </>
            ) : null}
            {performed.filesPending > 0 ? (
              <div className="record-facts__row">
                <dt>Files</dt>
                <dd>
                  The files were removed as this record was erased. The store is asked again
                  afterwards, and{' '}
                  {performed.filesPending === 1 ? 'one is' : `${performed.filesPending} are`}{' '}
                  waiting on that answer.
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="drawer__actions">
            {letterUrl ? (
              <a
                className="button button--secondary"
                href={letterUrl}
                download={letterFileName(record)}
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
                downloadName={letterFileName(record)}
                variant="secondary"
                label="Download the letter"
              />
            ) : null}
            {performed.notifyPhone ? (
              <Button variant="secondary" onClick={() => handToWhatsApp(performed)}>
                Draft a WhatsApp message
              </Button>
            ) : null}
          </div>
          <Note>
            The letter is filed as {letterFileName(record)}
            {performed.letterVersion ? `, from draft wording ${performed.letterVersion}` : ''},
            pending the practice&apos;s lawyer. Attach it to the message before sending.
          </Note>
          {performed.notifyPhone ? null : (
            <Note>
              No number was recorded with the request, so the letter has to be sent by hand.
            </Note>
          )}
          {sent || performed.letterSentAt ? (
            <Note tone="attention">
              Marked as sent. The number the confirmation went to is cleared once the files are
              confirmed gone.
            </Note>
          ) : null}
          {whatsAppUrl ? (
            <p className="small" role="status">
              Your browser stopped WhatsApp opening.{' '}
              <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer">
                Open the message
              </a>
            </p>
          ) : null}
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
              <dd>{askedBy(open)}</dd>
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
              <StepHeading>
                This erases record {record.mrn}. It cannot be undone. Here is what happens.
              </StepHeading>
              <ul className="record-facts__list">
                {WHAT_HAPPENS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                <li>
                  You will no longer be able to open this record afterwards unless you are the owner
                  or the lead practitioner, and they must say why each time.
                </li>
              </ul>
              <Textarea
                id="erasure-reason"
                label="Reason"
                rows={3}
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
              <StepHeading>Record that this household has asked to be forgotten</StepHeading>
              <Textarea
                id="erasure-ask-reason"
                label="Why the household has asked"
                rows={3}
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
                  <option value="">Choose</option>
                  {record.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contactName(contact) || contact.relationship}
                    </option>
                  ))}
                  <option value="none">Nobody on this record — no letter can be sent</option>
                </select>
                <p className="field__hint small muted">
                  Their number is kept with the request, and is the only way the confirmation can be
                  sent afterwards.
                </p>
              </div>
              <div className="drawer__actions">
                <Button
                  variant="primary"
                  disabled={busy || !askReason.trim() || askContactId === ''}
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
