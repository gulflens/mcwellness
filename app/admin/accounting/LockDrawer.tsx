import { useRef, useState, type FormEvent } from 'react';
import { mayLockThrough } from '@domain/accounting';
import { isoDateIn } from '@domain/shared';
import { isRealText, MINIMUM_REASON, type LockResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';

/**
 * "Lock through" (docs/SPEC/accounting.md section 4.4, rule 14). A lock is what
 * a filed VAT return leaves behind: no entry may be dated on or before the day
 * it names, in an open year or a closed one. It is never in the future, which
 * `mayLockThrough` decides here as well as in the route.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const FUTURE = 'The lock cannot be in the future.';

const REFUSALS: Record<string, string> = {
  lock_in_future: FUTURE,
  reason_required: 'Say why the lock is moving.',
  invalid_request: 'Choose a day, then try again.',
};
const FORBIDDEN = "You don't have permission to lock the books.";
const GENERIC = 'The lock could not be moved. Try again.';

export function LockDrawer({
  lockedThrough,
  onClose,
  onMoved,
}: {
  lockedThrough: string | null;
  onClose: () => void;
  onMoved: (answer: LockResponse) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [date, setDate] = useState(lockedThrough ?? '');
  const [reason, setReason] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setDateError(null);
    const today = isoDateIn(new Date(), PRACTICE_TIME_ZONE);
    if (!date || !mayLockThrough(date, today)) {
      setDateError(FUTURE);
      focusFirstInvalid(['lock-date']);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/accounting/lock', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ lockedThrough: date }),
      });
      if (res.ok) {
        onMoved((await res.json()) as LockResponse);
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN);
        return;
      }
      const answer = (await res.json().catch(() => null)) as {
        code?: string;
        error?: string;
      } | null;
      setFormError(REFUSALS[answer?.code ?? answer?.error ?? ''] ?? GENERIC);
    } catch {
      setFormError(GENERIC);
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
      aria-labelledby="lock-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="lock-drawer-title">Lock the books</h2>
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
        <form className="drawer__form" onSubmit={(event) => void submit(event)}>
          <p>
            No entry may be dated on or before the day you name, in an open year or a closed one.
            Moving the lock back is allowed, and is recorded as such.
          </p>
          <Field
            id="lock-date"
            label="Lock the books through"
            type="date"
            value={date}
            error={dateError ?? undefined}
            onChange={(e) => {
              setDate(e.target.value);
              setDateError(null);
            }}
          />
          <Field
            id="lock-reason"
            label="Why the lock moves"
            type="text"
            maxLength={200}
            value={reason}
            hint={`At least ${MINIMUM_REASON} characters.`}
            onChange={(e) => setReason(e.target.value)}
          />
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !isRealText(reason.trim())}>
              {busy ? 'Saving…' : 'Move the lock'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
