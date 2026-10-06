import { useMemo, useState } from 'react';
import { canTransition } from '@domain/client';
import { ageOn } from '@domain/shared';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { ActivationSummary } from './ActivationSummary';
import { ErasureSection } from './ErasureSection';
import { Textarea } from './FormAtoms';
import { IdentityForm } from './IdentityForm';
import { contactDisplayName } from './contactName';
import { canActivate, consentsOutstanding, practiceToday, toActivationRecord } from './activation';
import { canAskForErasure, canErase } from './clientAccess';

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};
const EMIRATE_LABELS: Record<string, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};
const SEX_LABELS: Record<string, string> = { female: 'Female', male: 'Male', unknown: 'Unknown' };

const ACTIVATION_ERROR = 'This client could not be activated. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to activate this client.";
const STATUS_ERROR = "This client's status could not be changed. Try again.";
const STATUS_FORBIDDEN = "You don't have permission to change this client's status.";
const STATUS_INCOMPLETE =
  'This record is missing something activation needs. Complete it, then reactivate.';

/** The moves this tab offers once a client is past lead, in the order the buttons stand. */
type StatusMove = 'active' | 'paused' | 'closed';
const MOVE_LABELS: Record<StatusMove, string> = {
  active: 'Reactivate',
  paused: 'Pause',
  closed: 'Close',
};

/**
 * Demographics, status, MRN, key contacts and the primary location as text —
 * no map yet (task brief item 1: that waits on a map provider and key, see
 * docs/CHANGE-REQUESTS/client-record-02.md).
 *
 * A lead also carries its activation gate here, not only inside the
 * enrolment wizard: a lead left half-finished last week is opened from the
 * list, and it would be a strange practice that had to start a new
 * enrolment to finish an old one. Same rule, same route
 * (docs/SPEC/client-record.md section 3).
 */
export function OverviewTab({
  record,
  onChanged,
  mayWrite,
  reason,
  onErased,
}: {
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the status route would refuse: the gate is shown, Activate and the
   * other status moves are not. */
  mayWrite: boolean;
  /** The reason an erased record was opened with, passed on to the routes that ask for one. */
  reason?: string;
  /** Told when this record has just been erased, with the reason it was erased with. */
  onErased?: (reason: string) => void;
}) {
  const { apiFetch, session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  const primaryLocation = record.locations.find((l) => l.isPrimary) ?? record.locations[0] ?? null;
  const age = record.dateOfBirth ? ageOn(record.dateOfBirth, practiceToday()) : null;
  const gate = useMemo(() => canActivate(toActivationRecord(record)), [record]);
  const toSign = useMemo(
    () => consentsOutstanding(toActivationRecord(record), practiceToday()).missing,
    [record],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // The status moves past lead (domain/client canTransition). Closing asks
  // first, and reactivating a closed record asks why: client-record.md
  // section 9 lists it among the sensitive actions, and the route refuses it
  // without a reason (app/api/clients/record.ts).
  const [confirming, setConfirming] = useState<'close' | 'reactivate' | null>(null);
  const [moveReason, setMoveReason] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const moves: StatusMove[] =
    mayWrite && record.status !== 'lead'
      ? (['active', 'paused', 'closed'] as const).filter((to) => canTransition(record.status, to))
      : [];

  async function move(to: StatusMove, reason?: string) {
    setMoveBusy(true);
    setMoveError(null);
    try {
      const res = await apiFetch(`/api/clients/${record.id}/status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(reason ? { 'x-reason': reason } : {}),
        },
        body: JSON.stringify({ to }),
      });
      if (res.status === 200) {
        setConfirming(null);
        setMoveReason('');
        onChanged();
        return;
      }
      if (res.status === 403) {
        setMoveError(STATUS_FORBIDDEN);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setMoveError(body?.error === 'incomplete' ? STATUS_INCOMPLETE : STATUS_ERROR);
    } catch {
      setMoveError(STATUS_ERROR);
    } finally {
      setMoveBusy(false);
    }
  }

  function press(to: StatusMove) {
    setMoveError(null);
    if (to === 'closed') setConfirming('close');
    else if (to === 'active' && record.status === 'closed') setConfirming('reactivate');
    else void move(to);
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${record.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'active' }),
      });
      if (res.status === 200) {
        onChanged();
        return;
      }
      setError(res.status === 403 ? FORBIDDEN_ERROR : ACTIVATION_ERROR);
    } catch {
      setError(ACTIVATION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-section">
      {record.status === 'lead' ? (
        <div className="tab-section">
          <ActivationSummary missing={gate.missing} toSign={toSign} />
          {gate.ok && mayWrite ? (
            <div className="drawer__actions">
              <Button variant="primary" disabled={busy} onClick={() => void activate()}>
                {busy ? 'Activating…' : 'Activate'}
              </Button>
            </div>
          ) : null}
          {error ? <Note tone="critical">{error}</Note> : null}
        </div>
      ) : null}
      {/* Once active, the consents still to sign before the first visit stay in
        view: that is exactly when they are outstanding. */}
      {record.status === 'active' && toSign.length > 0 ? (
        <div className="tab-section">
          <ActivationSummary missing={[]} toSign={toSign} activated />
        </div>
      ) : null}
      {moves.length > 0 && confirming === null ? (
        <div className="drawer__actions">
          {moves.map((to) => (
            <Button key={to} variant="secondary" disabled={moveBusy} onClick={() => press(to)}>
              {MOVE_LABELS[to]}
            </Button>
          ))}
        </div>
      ) : null}
      {confirming === 'close' ? (
        <div className="tab-section">
          <Note>
            Closing makes record {record.mrn} read-only except for documents. It can be reactivated
            later, with a reason.
          </Note>
          <div className="drawer__actions">
            <Button variant="primary" disabled={moveBusy} onClick={() => void move('closed')}>
              {moveBusy ? 'Closing…' : 'Close record'}
            </Button>
            <Button variant="quiet" disabled={moveBusy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {confirming === 'reactivate' ? (
        <div className="tab-section">
          <Textarea
            id="reactivate-reason"
            label="Reason"
            rows={3}
            hint="Recorded with the reactivation."
            value={moveReason}
            onChange={(event) => setMoveReason(event.target.value)}
          />
          <div className="drawer__actions">
            <Button
              variant="primary"
              disabled={moveBusy || !moveReason.trim()}
              onClick={() => void move('active', moveReason.trim())}
            >
              {moveBusy ? 'Reactivating…' : 'Reactivate record'}
            </Button>
            <Button variant="quiet" disabled={moveBusy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {moveError ? <Note tone="critical">{moveError}</Note> : null}
      {mayWrite && record.status !== 'erased' && !editing ? (
        <div className="drawer__actions">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      ) : null}
      {editing ? (
        <IdentityForm
          clientId={record.id}
          record={record}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <dl className="record-facts">
          <div className="record-facts__row">
            <dt>Date of birth</dt>
            <dd className="numeric">
              {record.dateOfBirth
                ? `${new Date(record.dateOfBirth).toLocaleDateString('en-GB')} (age ${age})`
                : 'Not recorded'}
            </dd>
          </div>
          <div className="record-facts__row">
            <dt>Sex at birth</dt>
            <dd>{record.sexAtBirth ? SEX_LABELS[record.sexAtBirth] : 'Not recorded'}</dd>
          </div>
          <div className="record-facts__row">
            <dt>Preferred language</dt>
            <dd>
              {record.preferredLocale === 'ar' ? 'Arabic' : 'English'}
              <p className="small muted">
                Decides the language of this household&rsquo;s consent wording and erasure letters.
                Cannot be changed from this screen yet.
              </p>
            </dd>
          </div>
          <div className="record-facts__row">
            <dt>Referral</dt>
            <dd>{record.referralSource ?? 'Not recorded'}</dd>
          </div>
          <div className="record-facts__row">
            <dt>Key contacts</dt>
            <dd>
              {record.contacts.length === 0 ? (
                'None yet'
              ) : (
                <ul className="record-facts__list">
                  {record.contacts.map((contact) => (
                    <li key={contact.id}>
                      <span>
                        {`${contactDisplayName(contact, record)} (${(RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship).toLowerCase()})`}
                      </span>
                      {contact.phone ? (
                        <span className="numeric muted">{contact.phone}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div className="record-facts__row">
            <dt>Primary location</dt>
            <dd>
              {primaryLocation ? (
                <ul className="record-facts__list">
                  <li>{EMIRATE_LABELS[primaryLocation.emirate] ?? primaryLocation.emirate}</li>
                  {primaryLocation.displayAddress ? (
                    <li>{primaryLocation.displayAddress}</li>
                  ) : null}
                  {primaryLocation.makaniNumber ? (
                    <li className="numeric muted">Makani {primaryLocation.makaniNumber}</li>
                  ) : null}
                </ul>
              ) : (
                'Not recorded'
              )}
            </dd>
          </div>
        </dl>
      )}
      <ErasureSection
        record={record}
        reason={reason}
        mayAsk={canAskForErasure(actor)}
        mayErase={canErase(actor)}
        onErased={onErased}
      />
    </div>
  );
}
