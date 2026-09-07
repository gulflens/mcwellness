import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { isoDateIn } from '@domain/shared';
import type { AccountRow, EntryResponse, SettingsResponse } from '../../api/accounting/schema';
import { isRealText, MINIMUM_REASON } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { formatDate, formatFils, isAedAmountTooLarge, parseAedToFils } from './money';
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';

/**
 * "Post an entry" (docs/SPEC/accounting.md section 5.2): a day, what the entry
 * is, and its lines — each an account, a side and an amount. The running
 * difference must read 0.00 before Save is offered, which is rule 1 said in the
 * one place a person can still do something about it; the domain refuses it
 * again, and so does the database.
 *
 * An opening entry is dated the books' start day and no other (rule 9), and may
 * be levelled with one line on the opening-balance account.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const SIDES = [
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
] as const;

type Line = { accountId: string; side: 'debit' | 'credit'; amount: string };

const EMPTY_LINE: Line = { accountId: '', side: 'debit', amount: '' };

const REFUSALS: Record<string, string> = {
  unbalanced: 'The debits and the credits do not come to the same figure.',
  // The lock's own date is named where the practice has one; this stands for a
  // closed year, which the drawer cannot know the bounds of.
  period_locked: 'The books are closed or locked on that day. Choose a later day.',
  opening_day: 'An opening entry is dated the day the books start, and no other.',
  opening_exists: 'The opening balances have already been posted.',
  unknown_account: 'One of the accounts is no longer part of the chart. Reload and try again.',
  not_an_opening_entry: 'Only an opening entry can be levelled with opening balance equity.',
  reason_required: 'Say why this entry is being posted.',
  invalid_request: 'Check the day, the memo and the lines, then try again.',
};
const FORBIDDEN = "You don't have permission to post an entry.";
const GENERIC = 'The entry could not be posted. Try again.';

function fils(line: Line): number | null {
  return line.amount.trim() === '' ? 0 : parseAedToFils(line.amount);
}

export function EntryDrawer({
  accounts,
  settings,
  onClose,
  onPosted,
}: {
  accounts: readonly AccountRow[];
  settings: SettingsResponse;
  onClose: () => void;
  onPosted: (entry: EntryResponse) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [kind, setKind] = useState<'manual' | 'opening'>('manual');
  const [enteredOn, setEnteredOn] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [memo, setMemo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([EMPTY_LINE, EMPTY_LINE]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useMemo(() => accounts.filter((account) => account.archivedAt === null), [accounts]);
  const day = kind === 'opening' ? settings.booksStartOn : enteredOn;

  /**
   * Rule 3, said with the date in it (docs/SPEC/accounting.md section 5.2).
   * The lock is already on this screen, so a day it shuts is refused here and
   * the sentence names the day the books are locked through rather than
   * leaving the person to guess which days are open. The same sentence answers
   * the server's `409 period_locked`, so the drawer never says two things
   * about one rule.
   */
  const locked = settings.lockedThrough;
  const lockedOut = locked !== null && day <= locked;
  const lockSentence =
    locked === null
      ? REFUSALS.period_locked!
      : `The books are locked through ${formatDate(locked)}. Choose a later day.`;

  // The running difference the person watches, and how many lines actually
  // carry an amount. One pass, no early return: an amount that is not an amount
  // leaves the difference unreadable rather than silently counted as nothing.
  const totals = useMemo(() => {
    let debits = 0;
    let credits = 0;
    let usable = 0;
    let readable = true;
    for (const line of lines) {
      const amount = fils(line);
      if (amount === null) {
        readable = false;
      } else {
        if (amount > 0 && line.accountId !== '') {
          usable += 1;
        }
        if (line.side === 'debit') {
          debits += amount;
        } else {
          credits += amount;
        }
      }
    }
    return { debits, credits, difference: readable ? debits - credits : null, usable };
  }, [lines]);

  const balanced = totals.difference === 0 && totals.usable >= 2;
  const complete = balanced && memo.trim() !== '' && isRealText(reason.trim()) && !lockedOut;

  const setLine = useCallback((index: number, patch: Partial<Line>) => {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  }, []);

  const addLine = useCallback(() => setLines((current) => [...current, EMPTY_LINE]), []);

  async function send(balanceWithOpeningEquity: boolean): Promise<void> {
    setFormError(null);
    if (lockedOut) {
      // The sentence is already under the day field and bound to it, so this
      // moves to where it is rather than saying it a second time (./refusal.ts).
      focusFirstInvalid(['entry-day']);
      return;
    }
    if (lines.some((line) => isAedAmountTooLarge(line.amount))) {
      setFormError('One of the amounts is larger than a single line may carry.');
      focusFirstInvalid(['entry-line-1-amount']);
      return;
    }
    const body = {
      kind,
      enteredOn: day,
      memo: memo.trim(),
      balanceWithOpeningEquity,
      lines: lines
        .filter((line) => line.accountId !== '' && (fils(line) ?? 0) > 0)
        .map((line) => ({
          accountId: line.accountId,
          debitFils: line.side === 'debit' ? (fils(line) ?? 0) : 0,
          creditFils: line.side === 'credit' ? (fils(line) ?? 0) : 0,
        })),
    };
    setBusy(true);
    try {
      const res = await apiFetch('/api/accounting/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        onPosted((await res.json()) as EntryResponse);
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
      setFormError(code === 'period_locked' ? lockSentence : (REFUSALS[code] ?? GENERIC));
    } catch {
      setFormError(GENERIC);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void send(false);
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entry-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="entry-drawer-title">Post an entry</h2>
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
        <form className="drawer__form" onSubmit={submit}>
          {settings.entryCount === 0 ? (
            <Select
              id="entry-kind"
              label="What kind of entry"
              value={kind}
              onChange={(e) => setKind(e.target.value === 'opening' ? 'opening' : 'manual')}
            >
              <option value="manual">An entry of the practice&apos;s own</option>
              <option value="opening">The opening balances</option>
            </Select>
          ) : null}

          <Field
            id="entry-day"
            label="Day"
            type="date"
            value={day}
            disabled={kind === 'opening'}
            error={lockedOut ? lockSentence : undefined}
            hint={
              kind === 'opening' ? 'An opening entry is dated the day the books start.' : undefined
            }
            onChange={(e) => setEnteredOn(e.target.value)}
          />

          <Field
            id="entry-memo"
            label="What this entry is"
            type="text"
            maxLength={200}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          <div className="lines-editor">
            {lines.map((line, index) => (
              <div className="lines-editor__row" key={`line-${index}`}>
                <Select
                  id={`entry-line-${index + 1}-account`}
                  label={`Line ${index + 1} account`}
                  value={line.accountId}
                  onChange={(e) => setLine(index, { accountId: e.target.value })}
                >
                  <option value="">Choose an account</option>
                  {open.map((account) => (
                    <option key={account.id} value={account.id}>
                      {`${account.code} ${account.name}`}
                    </option>
                  ))}
                </Select>
                <Select
                  id={`entry-line-${index + 1}-side`}
                  label={`Line ${index + 1} side`}
                  value={line.side}
                  onChange={(e) =>
                    setLine(index, { side: e.target.value === 'credit' ? 'credit' : 'debit' })
                  }
                >
                  {SIDES.map((side) => (
                    <option key={side.value} value={side.value}>
                      {side.label}
                    </option>
                  ))}
                </Select>
                <Field
                  id={`entry-line-${index + 1}-amount`}
                  label={`Line ${index + 1} amount`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={line.amount}
                  onChange={(e) => setLine(index, { amount: e.target.value })}
                />
              </div>
            ))}
            <Button type="button" variant="quiet" onClick={addLine}>
              Add a line
            </Button>
          </div>

          <div className="difference">
            <span className="small muted">Difference</span>
            <span className="numeric">
              {totals.difference === null ? '—' : formatFils(totals.difference)}
            </span>
          </div>

          <Field
            id="entry-reason"
            label="Why this entry is posted"
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
            {kind === 'opening' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy || lockedOut || memo.trim() === '' || !isRealText(reason.trim())}
                onClick={() => void send(true)}
              >
                Balance with opening equity
              </Button>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy || !complete}>
              {busy ? 'Posting…' : 'Post the entry'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
