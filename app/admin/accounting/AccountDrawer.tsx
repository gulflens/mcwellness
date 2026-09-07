import { useRef, useState, type FormEvent } from 'react';
import { ACCOUNT_TYPES, codeMatchesType, type AccountType } from '@domain/accounting';
import { isRealText, MINIMUM_REASON, type AccountResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';
import { ACCOUNT_TYPE_WORDS } from './words';

/**
 * "Add account" (docs/SPEC/accounting.md section 5.3, rule 7). The code's
 * first digit and the kind of account must agree, which `codeMatchesType` from
 * `@domain/accounting` decides here — the same function the route calls and the
 * database's own check constraint restates, so a person is told before a
 * request is made rather than after one is refused.
 */

const CODE_SENTENCES: Record<AccountType, string> = {
  asset: "An asset's code starts with 1.",
  liability: "A liability's code starts with 2.",
  equity: "An equity account's code starts with 3.",
  income: "An income account's code starts with 4.",
  expense: "An expense's code starts with 5 or 6.",
};

const REFUSALS: Record<string, string> = {
  duplicate_code: 'The practice already has an account with that code.',
  code_type_mismatch: 'The code and the kind of account do not agree.',
  reason_required: 'Say why this account is being added.',
  invalid_request: 'Check the code and the name, then try again.',
};
const FORBIDDEN = "You don't have permission to add an account.";
const GENERIC = 'The account could not be added. Try again.';

export function AccountDrawer({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (account: AccountResponse) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('expense');
  const [reason, setReason] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setCodeError(null);
    if (!codeMatchesType(code.trim(), type)) {
      setCodeError(CODE_SENTENCES[type]);
      focusFirstInvalid(['account-code']);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/accounting/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ code: code.trim(), name: name.trim(), type }),
      });
      if (res.status === 201) {
        onAdded((await res.json()) as AccountResponse);
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
      aria-labelledby="account-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="account-drawer-title">Add account</h2>
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
          <Select
            id="account-type"
            label="Kind of account"
            value={type}
            onChange={(e) => {
              setType(e.target.value as AccountType);
              setCodeError(null);
            }}
          >
            {ACCOUNT_TYPES.map((option) => (
              <option key={option} value={option}>
                {ACCOUNT_TYPE_WORDS[option]}
              </option>
            ))}
          </Select>

          <Field
            id="account-code"
            label="Code"
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={code}
            error={codeError ?? undefined}
            hint={CODE_SENTENCES[type]}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError(null);
            }}
          />

          <Field
            id="account-name"
            label="Name"
            type="text"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <Field
            id="account-reason"
            label="Why this account is added"
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
            <Button
              type="submit"
              variant="primary"
              disabled={busy || name.trim() === '' || !isRealText(reason.trim())}
            >
              {busy ? 'Saving…' : 'Add the account'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
