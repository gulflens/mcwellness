import { useRef, useState, type FormEvent } from 'react';
import { isRealText, MINIMUM_REASON, type SettingsResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from './useDrawer';

/**
 * The books' own settings (docs/SPEC/accounting.md section 5.5): the year end,
 * the corporate-tax rate and threshold, and the Small Business Relief election
 * with its threshold. The year end is offered only while the journal is empty
 * (rule 10); the route refuses it again, and this only says so first.
 */

const REFUSALS: Record<string, string> = {
  journal_not_empty: 'The year end can change only while the journal is empty.',
  reason_required: 'Say why the settings are changing.',
  invalid_request: 'Check the figures, then try again.',
};
const FORBIDDEN = "You don't have permission to change the books' settings.";
const GENERIC = 'The settings could not be saved. Try again.';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function SettingsDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: SettingsResponse;
  onClose: () => void;
  onSaved: (settings: SettingsResponse) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const canMoveYearEnd = settings.entryCount === 0;
  const [yearEndMonth, setYearEndMonth] = useState(String(settings.yearEndMonth));
  const [yearEndDay, setYearEndDay] = useState(String(settings.yearEndDay));
  const [rate, setRate] = useState(String(settings.corporateTaxRateBasisPoints));
  const [elected, setElected] = useState(settings.smallBusinessReliefElected);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    const body: Record<string, unknown> = {
      corporateTaxRateBasisPoints: Number(rate),
      smallBusinessReliefElected: elected,
    };
    if (canMoveYearEnd) {
      body.yearEndMonth = Number(yearEndMonth);
      body.yearEndDay = Number(yearEndDay);
    }
    try {
      const res = await apiFetch('/api/accounting/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved((await res.json()) as SettingsResponse);
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
      aria-labelledby="settings-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="settings-drawer-title">The books&apos; settings</h2>
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
            id="settings-year-end-month"
            label="The financial year ends in"
            value={yearEndMonth}
            disabled={!canMoveYearEnd}
            hint={
              canMoveYearEnd
                ? undefined
                : 'The year end can change only while the journal is empty.'
            }
            onChange={(e) => setYearEndMonth(e.target.value)}
          >
            {MONTHS.map((month, index) => (
              <option key={month} value={String(index + 1)}>
                {month}
              </option>
            ))}
          </Select>

          <Field
            id="settings-year-end-day"
            label="On the day"
            type="number"
            min={1}
            max={31}
            value={yearEndDay}
            disabled={!canMoveYearEnd}
            onChange={(e) => setYearEndDay(e.target.value)}
          />

          <Field
            id="settings-tax-rate"
            label="Corporate tax rate, in basis points"
            type="number"
            min={0}
            max={10_000}
            value={rate}
            hint="900 basis points is 9 percent."
            onChange={(e) => setRate(e.target.value)}
          />

          <Select
            id="settings-relief"
            label="Small Business Relief"
            value={elected ? 'yes' : 'no'}
            onChange={(e) => setElected(e.target.value === 'yes')}
          >
            <option value="yes">Elected this year</option>
            <option value="no">Not elected</option>
          </Select>

          <Field
            id="settings-reason"
            label="Why the settings change"
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
              {busy ? 'Saving…' : 'Save the settings'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
