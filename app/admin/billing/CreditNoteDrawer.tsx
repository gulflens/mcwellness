import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CreditQuoteResponse,
  CreditRefusal,
  IssueCreditNoteResponse,
  type InvoiceRow,
} from '../../api/billing/ledger-schema';
import { isRealText } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { formatFils } from './money';
import { useDrawer } from './useDrawer';

/**
 * Issuing a credit note on an invoice (credit notes, Task 8).
 *
 * The drawer asks the server what a note would credit before it offers one
 * (`GET .../credit-quote`), so the sums on screen are the server's and the
 * refusals are said up front rather than after a press. The sentence about a
 * mistake is there so "credit note" is not mistaken for "end this package
 * early", which is a different act that does not exist.
 *
 * The idempotency key is made once when the drawer opens: a retry of the same
 * press (a double tap, a lost response) replays the first answer, while a
 * drawer opened again is a new decision and gets a new key.
 */

const REFUSALS: Record<CreditRefusal, string> = {
  statement: 'A statement is a summary, not a sale, so it cannot be credited.',
  waived: 'This charge was waived, so there is nothing to credit.',
  already_credited: 'This invoice already has a credit note.',
  nothing_left: 'There is nothing left on this invoice to credit.',
  client_erased: "This client's record has been erased, so a credit note cannot be issued.",
};

const FORBIDDEN_MESSAGE = "You don't have permission to issue a credit note.";
const NOT_FOUND_MESSAGE = 'This invoice is no longer there. Reload the list to see what changed.';
const GENERIC_MESSAGE = 'The credit note could not be issued. Try again.';
const REASON_MESSAGE = 'Say why it is being credited, in a few words.';
const REASON_HINT = "Don't include names or health details.";
const QUOTE_FAILED = 'What this would credit could not be worked out. Close this and try again.';

type Quote =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'refused'; refusal: CreditRefusal }
  | { kind: 'ready'; plan: Extract<CreditQuoteResponse, { ok: true }>['plan'] };

export function CreditNoteDrawer({
  invoice,
  onClose,
  onIssued,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onIssued: (note: IssueCreditNoteResponse['creditNote']) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [quote, setQuote] = useState<Quote>({ kind: 'loading' });
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/billing/invoices/${invoice.id}/credit-quote`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`quote ${res.status}`);
        const answer = CreditQuoteResponse.parse(await res.json());
        if (!live) return;
        setQuote(
          answer.ok
            ? { kind: 'ready', plan: answer.plan }
            : { kind: 'refused', refusal: answer.refusal },
        );
      })
      .catch(() => {
        if (live) setQuote({ kind: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, invoice.id]);

  const trimmed = reason.trim();
  // The server's own test (ledger-schema's Reason): eight characters that are
  // not all spaces and not all the same one, so "........" is not a reason.
  const longEnough = isRealText(trimmed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!longEnough) return;
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/invoices/${invoice.id}/credit-note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: trimmed, idempotencyKey }),
      });
      if (res.ok) {
        onIssued(IssueCreditNoteResponse.parse(await res.json()).creditNote);
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { refusal?: string } | null;
        const refusal = CreditRefusal.safeParse(body?.refusal);
        setFormError(refusal.success ? REFUSALS[refusal.data] : GENERIC_MESSAGE);
        return;
      }
      if (res.status === 400) setFormError(REASON_MESSAGE);
      else if (res.status === 403) setFormError(FORBIDDEN_MESSAGE);
      else if (res.status === 404) setFormError(NOT_FOUND_MESSAGE);
      else setFormError(GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-note-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="credit-note-title">Credit note for {invoice.reference}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <form className="drawer__form" onSubmit={(e) => void submit(e)}>
          <p>This corrects a mistake. It is not how a package is ended early.</p>

          {quote.kind === 'loading' ? <Note>Working out what this would credit.</Note> : null}
          {quote.kind === 'failed' ? <Note tone="critical">{QUOTE_FAILED}</Note> : null}
          {quote.kind === 'refused' ? <Note>{REFUSALS[quote.refusal]}</Note> : null}
          {quote.kind === 'ready' ? (
            <dl className="figures">
              <div>
                <dt>Credited (AED)</dt>
                <dd className="numeric">{formatFils(quote.plan.grossFils)}</dd>
              </div>
              {quote.plan.usedCredits + quote.plan.unusedCredits > 0 ? (
                <div>
                  <dt>Sessions</dt>
                  <dd className="numeric">
                    {quote.plan.unusedCredits} unused of{' '}
                    {quote.plan.usedCredits + quote.plan.unusedCredits}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {quote.kind === 'ready' ? (
            <>
              <Field
                id="credit-note-reason"
                label="Why is it being credited?"
                type="text"
                maxLength={200}
                hint={REASON_HINT}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {formError ? <Note tone="critical">{formError}</Note> : null}
              <div className="drawer__actions">
                <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !longEnough}>
                  Issue credit note
                </Button>
              </div>
            </>
          ) : (
            <div className="drawer__actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </form>
      </div>
    </aside>
  );
}
