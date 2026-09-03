import { useEffect, useRef, useState } from 'react';
import {
  NOTICE_HOURS_MAX,
  SchedulingSettingsResponse,
  UNFIT_FEE_FILS_MAX,
} from '../../api/appointments/schema';
import { formatFils, parseAedToFils } from '../billing/money';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';

/**
 * The practice's own cancellation policy: how much notice a household must
 * give, and what a visit costs when the practitioner arrives and it cannot go
 * ahead (db/migrations/202_scheduling_setting.sql, the operator's decisions of
 * 2026-09-03).
 *
 * Both figures were called the owner's to change from the day they were added,
 * and until this screen they were editable in the way a column is editable —
 * by somebody with a database client (compliance review of this pull request).
 *
 * It lives beside the schedule rather than in Settings because it is read here:
 * the notice period is the sentence the cancel drawer says out loud before a
 * coordinator calls a visit off, and the place to change a rule is next to
 * where its consequences are visible.
 */

const LOAD_ERROR = 'The practice’s cancellation policy could not be read. Try again.';

export function CancellationPolicyDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [loaded, setLoaded] = useState<SchedulingSettingsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noticeHours, setNoticeHours] = useState('');
  const [fee, setFee] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  useEffect(() => {
    let live = true;
    void apiFetch('/api/appointments/settings')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setLoadFailed(true);
          return;
        }
        const parsed = SchedulingSettingsResponse.safeParse(await res.json());
        if (!parsed.success) {
          setLoadFailed(true);
          return;
        }
        setLoaded(parsed.data);
        setNoticeHours(String(parsed.data.noticeHours));
        setFee(formatFils(parsed.data.unfitFeeFils));
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const hours = Number(noticeHours);
  const hoursValid =
    noticeHours.trim() !== '' && Number.isInteger(hours) && hours >= 0 && hours <= NOTICE_HOURS_MAX;
  const feeFils = parseAedToFils(fee);
  const feeValid = feeFils !== null && feeFils <= UNFIT_FEE_FILS_MAX;
  const changed =
    loaded !== null &&
    ((hoursValid && hours !== loaded.noticeHours) || (feeValid && feeFils !== loaded.unfitFeeFils));
  const canSave = hoursValid && feeValid && changed && Boolean(reason.trim()) && !saving;

  async function save() {
    if (!canSave || feeFils === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/appointments/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ noticeHours: hours, unfitFeeFils: feeFils }),
      });
      if (res.ok) {
        const parsed = SchedulingSettingsResponse.parse(await res.json());
        setLoaded(parsed);
        setSaved(true);
        setReason('');
        onSaved();
        return;
      }
      setError(
        res.status === 403
          ? 'Changing the cancellation policy is the owner’s or an admin’s.'
          : 'The cancellation policy could not be changed. Try again.',
      );
    } catch {
      setError('The cancellation policy could not be changed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="cancellation-policy-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="cancellation-policy-title">Cancellation policy</h2>
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
        <div className="stepper">
          {loadFailed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
          {loaded === null && !loadFailed ? <Note>Reading the current policy.</Note> : null}
          {loaded !== null ? (
            <>
              <div className="stepper__step">
                <Field
                  id="policy-notice-hours"
                  label="Notice a household must give (hours)"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={NOTICE_HOURS_MAX}
                  value={noticeHours}
                  onChange={(e) => {
                    setNoticeHours(e.target.value);
                    setSaved(false);
                    setError(null);
                  }}
                  error={
                    noticeHours.trim() !== '' && !hoursValid
                      ? `A whole number of hours, from 0 to ${NOTICE_HOURS_MAX}.`
                      : undefined
                  }
                  hint={
                    hoursValid
                      ? 'A visit called off with less notice than this uses one of the client’s sessions.'
                      : undefined
                  }
                />
              </div>

              <div className="stepper__step">
                <Field
                  id="policy-unfit-fee"
                  label="Fee when a visit cannot go ahead at the door (AED)"
                  type="text"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => {
                    setFee(e.target.value);
                    setSaved(false);
                    setError(null);
                  }}
                  error={
                    fee.trim() !== '' && !feeValid ? 'An amount in AED, such as 150.00.' : undefined
                  }
                  hint={
                    feeValid
                      ? 'Shown to the coordinator when they record one. Nothing charges it automatically.'
                      : undefined
                  }
                />
              </div>

              <div className="stepper__step">
                <Field
                  id="policy-reason"
                  label="Why is it changing?"
                  type="text"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(null);
                  }}
                  hint="Recorded against the change. This decides what every future cancellation costs."
                />
              </div>

              {saved ? <Note>The cancellation policy is saved.</Note> : null}
              {error ? <Note tone="critical">{error}</Note> : null}

              <div className="stepper__submit">
                <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save policy'}
                </Button>
                {!changed && hoursValid && feeValid ? (
                  <span className="small muted">Change a figure first.</span>
                ) : changed && !reason.trim() ? (
                  <span className="small muted">Say why it is changing first.</span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
