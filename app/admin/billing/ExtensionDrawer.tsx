import { useRef, useState, type FormEvent } from 'react';
import { ExtendPurchaseResponse, type PurchaseRow } from '../../api/billing/ledger-schema';
import { isRealText, MINIMUM_REASON } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';
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
 * The length is not the coordinator's to choose, and neither is the count:
 * an extension is always exactly three months, a programme may have at most
 * two, and this drawer offers nothing once it has had them — the route
 * refuses a third for everybody, the owner included
 * (docs/PLAN/package-terms.md).
 */

const FORBIDDEN_MESSAGE = "You don't have permission to extend a programme.";
const NOT_FOUND_MESSAGE = 'This programme is no longer available. Refresh and try again.';
const GENERIC_MESSAGE = 'The programme could not be extended. Try again.';
const MESSAGES: Record<string, string> = {
  invalid_request: 'Check the reason, then try again.',
  not_extendable: 'This programme has been refunded or called off, so it cannot be extended.',
  extension_limit_reached:
    'This programme has had its two extensions. A programme that needs longer is a refund and a new sale.',
  ended_too_long_ago:
    'This programme ended more than three months ago, so three more months would still be in the past. A programme that needs longer is a refund and a new sale.',
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
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const runsTo = purchase.extendedTo ?? purchase.expiresOn;
  const used = purchase.extensionsUsed;
  const left =
    used === 0 ? 'None of the two used yet.' : used === 1 ? '1 of the two used.' : 'Both used.';
  const sentence = purchase.extendsTo
    ? `It runs to ${formatDate(runsTo)} today. An extension adds three months, to ${formatDate(purchase.extendsTo)}. ${left}`
    : 'This programme has had its two extensions.';
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!isRealText(reason.trim())) {
      setReasonError(
        `Say why this programme is being extended, in at least ${MINIMUM_REASON} characters.`,
      );
      focusFirstInvalid(['extension-reason']);
      return;
    }
    setReasonError(undefined);

    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/package-purchases/${purchase.id}/extension`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.status === 201) {
        const body = ExtendPurchaseResponse.parse(await res.json());
        onExtended(
          `Extended to ${formatDate(body.purchase.extendedTo ?? body.purchase.expiresOn)}.`,
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
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extension-drawer-title"
    >
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
          <p className="small muted">{sentence}</p>
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

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Extend by three months'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
