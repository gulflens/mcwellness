import { useRef, useState, type FormEvent } from 'react';
import { isRealText, MINIMUM_REASON } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from './useDrawer';

/**
 * One drawer, three uses: reversing an entry, closing a financial year and
 * reopening one. Each is the same act from the screen's point of view — a
 * sentence saying why, and a POST that carries it as `X-Reason` — and three
 * components that differed only in their words would be three places to keep
 * one behaviour in step.
 */

const FORBIDDEN = "You don't have permission to do that.";
const GENERIC = 'It could not be saved. Try again.';

export function ReasonDrawer({
  title,
  what,
  reasonLabel,
  submitLabel,
  path,
  refusals,
  onClose,
  onDone,
}: {
  title: string;
  /** A plain sentence naming what is about to happen; no id, no household. */
  what: string;
  reasonLabel: string;
  submitLabel: string;
  path: string;
  /** A fixed sentence per refusal code the route can answer with. */
  refusals: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.ok) {
        onDone();
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
      const code = answer?.code ?? answer?.error ?? '';
      setFormError(refusals[code] ?? GENERIC);
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
      aria-labelledby="reason-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="reason-drawer-title">{title}</h2>
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
        <form className="drawer__form" onSubmit={(event) => void send(event)}>
          <p>{what}</p>
          <Field
            id="reason-drawer-reason"
            label={reasonLabel}
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
              {busy ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
