import { useRef, useState, type FormEvent } from 'react';
import { PackageResponse, type PackageRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from './useDrawer';

/**
 * Withdrawing a bundle the practice no longer offers (round 62,
 * `PATCH /api/billing/packages/:id` from Task 1, docs/SPEC/billing.md).
 *
 * Nothing here deletes. A household who already bought this bundle keeps
 * every session it carries; withdrawing only stops the next household from
 * buying it, which is the one sentence this drawer says rather than leaving
 * "Withdraw" to read as if the bundle itself were being removed. The reason
 * is the same `x-reason` the route requires, landed on the audit trail by the
 * request-context middleware once the request is sent.
 */

const FORBIDDEN_MESSAGE = "You don't have permission to withdraw a package.";
const NOT_FOUND_MESSAGE = 'This package is no longer there. Reload the list to see what changed.';
const GENERIC_MESSAGE = 'The package could not be withdrawn. Try again.';

export function WithdrawPackageDrawer({
  bundle,
  onClose,
  onWithdrawn,
}: {
  bundle: PackageRow;
  onClose: () => void;
  onWithdrawn: (updated: PackageRow) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/packages/${bundle.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-reason': trimmed },
        body: JSON.stringify({ status: 'inactive' }),
      });
      if (res.ok) {
        onWithdrawn(PackageResponse.parse(await res.json()).package);
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
      aria-labelledby="withdraw-package-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="withdraw-package-title">Withdraw {bundle.name}</h2>
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
          <p>Households who bought it keep their sessions; nobody can buy it after this.</p>
          <Field
            id="withdraw-reason"
            label="Why"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !reason.trim()}>
              Withdraw
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
