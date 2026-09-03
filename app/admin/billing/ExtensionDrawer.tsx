import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExtendPurchaseResponse, type PurchaseRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { formatDate } from './BillingPage';

/**
 * "Give them longer" — the coordinator's discretion over a programme that has
 * run out of time, with the reason it always carries.
 *
 * The reason is the field that matters. A family whose year ran out during a
 * hospital stay is not the same as one that simply did not book, and a year
 * from now the practice should be able to see which it was. It goes on the
 * purchase and into the audit trail, not into somebody's memory.
 *
 * The date it replaces is shown rather than assumed: an extension that gives
 * a family less time than they had is refused, and saying what they have now
 * is how a person avoids typing one.
 */

const FORBIDDEN_MESSAGE = "You don't have permission to extend a programme.";
const NOT_FOUND_MESSAGE = 'This programme is no longer available. Refresh and try again.';
const GENERIC_MESSAGE = 'The programme could not be extended. Try again.';
const MESSAGES: Record<string, string> = {
  not_later: 'Choose a date later than the one this programme already runs to.',
  date_in_past: 'Choose a date in the future.',
  invalid_request: 'Check the date and the reason, then try again.',
  not_extendable: 'This programme has been refunded or called off, so it cannot be extended.',
};

export function ExtensionDrawer({
  purchase,
  onClose,
  onExtended,
}: {
  purchase: PurchaseRow;
  onClose: () => void;
  onExtended: (summary: string) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const runsTo = purchase.extendedTo ?? purchase.expiresOn;
  const [extendedTo, setExtendedTo] = useState('');
  const [reason, setReason] = useState('');
  const [dateError, setDateError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    let refused = false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extendedTo)) {
      setDateError('Choose the date it should run to.');
      refused = true;
    } else if (extendedTo <= runsTo) {
      setDateError(`Choose a date after ${formatDate(runsTo)}.`);
      refused = true;
    } else {
      setDateError(undefined);
    }
    if (reason.trim().length < 1) {
      setReasonError('Say why this programme is being extended.');
      refused = true;
    } else {
      setReasonError(undefined);
    }
    if (refused) return;

    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/package-purchases/${purchase.id}/extension`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ extendedTo, reason: reason.trim() }),
      });
      if (res.status === 201) {
        const body = ExtendPurchaseResponse.parse(await res.json());
        onExtended(
          `${body.purchase.packageName} now runs to ` +
            `${formatDate(body.purchase.extendedTo ?? body.purchase.expiresOn)}.`,
        );
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 404) {
        setFormError(NOT_FOUND_MESSAGE);
        return;
      }
      if (res.status === 400 || res.status === 409) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setFormError(MESSAGES[body?.code ?? ''] ?? GENERIC_MESSAGE);
        return;
      }
      setFormError(GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="extension-drawer-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="extension-drawer-title">Give them longer</h2>
          <p className="small muted">
            {purchase.packageName}, bought {formatDate(purchase.purchasedOn)}
          </p>
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
          <Field
            id="extension-date"
            label="Runs to"
            type="date"
            value={extendedTo}
            onChange={(e) => {
              setExtendedTo(e.target.value);
              setDateError(undefined);
            }}
            hint={`It runs to ${formatDate(runsTo)} today.`}
            error={dateError}
          />
          <Field
            id="extension-reason"
            label="Why"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
            }}
            hint="Kept with the programme and in the record of who changed it."
            error={reasonError}
          />

          <p className="small muted">
            The date first agreed stays on the record beside the new one.
          </p>

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Extend it'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
