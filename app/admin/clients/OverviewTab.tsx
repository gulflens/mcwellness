import { useMemo, useState } from 'react';
import { ageOn } from '@domain/shared';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { ActivationSummary } from './ActivationSummary';
import { ErasureSection } from './ErasureSection';
import { contactName } from './contactName';
import { canActivate, practiceToday, toActivationRecord } from './activation';
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
  /** False for a role the status route would refuse: the gate is shown, Activate is not. */
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
  const gate = useMemo(() => canActivate(toActivationRecord(record), practiceToday()), [record]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <ActivationSummary missing={gate.missing} />
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
          <dd>{record.preferredLocale === 'ar' ? 'Arabic' : 'English'}</dd>
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
                      {contactName(contact)
                        ? `${contactName(contact)} (${(RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship).toLowerCase()})`
                        : (RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship)}
                    </span>
                    {contact.phone ? <span className="numeric muted">{contact.phone}</span> : null}
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
                {primaryLocation.displayAddress ? <li>{primaryLocation.displayAddress}</li> : null}
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
