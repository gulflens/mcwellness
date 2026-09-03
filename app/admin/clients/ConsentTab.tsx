import { useState } from 'react';
import { CONSENT_PURPOSES, requiredConsents, type ConsentPurpose } from '@domain/client';
import {
  WithdrawConsentResponse,
  type ClientRecordResponse,
  type Consent,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { practiceToday, toActivationRecord } from './activation';
import { contactName } from './contactName';
import { DocumentLink } from './DocumentLink';
import { RecordConsentForm } from './RecordConsentForm';

const PURPOSE_LABELS: Record<string, string> = {
  participation: 'Taking part',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  photo_video: 'Photographs and video',
  research: 'Research',
  marketing: 'Marketing',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  superseded: 'Replaced by a later consent',
};
const METHOD_LABELS: Record<string, string> = {
  app_signature: 'Signed on screen',
  paper_scan: 'Paper form on file',
  verbal_witnessed: 'Confirmed verbally, witnessed',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

const WITHDRAW_ERROR = 'This consent could not be withdrawn. Try again.';

function isActiveOn(consent: Consent, today: string, purpose: ConsentPurpose): boolean {
  return (
    consent.purpose === purpose &&
    consent.status === 'active' &&
    (consent.expiresAt === null || consent.expiresAt > today)
  );
}

/**
 * Consent (docs/SPEC/client-record.md sections 4.2 and 7). The drawer's tab
 * and the enrolment wizard's consent step are the same component, because they
 * are the same job at two moments.
 *
 * Three parts: what this client needs before they can be activated, from
 * `requiredConsents` in domain/client, so a guardian's consent appears the
 * moment a date of birth makes the client a child; every purpose with what is
 * on file for it; and, for each, the way to record a new one or withdraw the
 * one standing.
 *
 * Recording arrived with documents, which is what the third pull request said
 * it was waiting for (docs/CHANGE-REQUESTS/client-record-02.md): the route
 * needed the exact wording shown and the evidence of what was signed, and
 * neither could be named until there was somewhere to keep a file.
 *
 * A withdrawal asks for a reason before it will go, and says plainly what it
 * does and does not do: it stops the consent at once, and it does not touch
 * appointments already in the diary, which is scheduling's to do.
 */
export function ConsentTab({
  clientId,
  record,
  onChanged,
  mayWrite,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the consent routes would refuse: no recording, no withdrawal. */
  mayWrite: boolean;
}) {
  const today = practiceToday();
  // As a set of plain strings: `requiredConsents` answers with the three
  // purposes activation can ever ask for, and this list runs over all six.
  const required = new Set<string>(requiredConsents(toActivationRecord(record), ['home'], today));
  const consenting = record.contacts.filter((contact) => contact.canConsent);
  const [recording, setRecording] = useState<ConsentPurpose | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { apiFetch } = useAuth();

  function nameOf(contactId: string): string {
    const contact = record.contacts.find((candidate) => candidate.id === contactId);
    if (!contact) return 'A contact no longer on this record';
    const relationship = RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship;
    const name = contactName(contact);
    return name === null ? relationship : `${name} (${relationship.toLowerCase()})`;
  }

  async function withdraw(consentId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/consents/${consentId}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        // Withdrawing photographs and video takes the photographs with it, so
        // the screen says how many rather than leaving the household to
        // wonder (app/api/clients/withdrawal.ts).
        const body = WithdrawConsentResponse.safeParse(await res.json());
        if (body.success && body.data.photographsStillOnFile > 0) {
          setOutcome(
            `Consent withdrawn. ${body.data.photographsStillOnFile} setup ${
              body.data.photographsStillOnFile === 1 ? 'photograph is' : 'photographs are'
            } still on file: the document store could not be reached, so tell whoever keeps it.`,
          );
        } else if (body.success && body.data.photographsRemoved > 0) {
          setOutcome(
            `Consent withdrawn, and ${body.data.photographsRemoved} setup ${
              body.data.photographsRemoved === 1 ? 'photograph was' : 'photographs were'
            } removed.`,
          );
        } else {
          setOutcome(null);
        }
        setWithdrawing(null);
        setReason('');
        onChanged();
        return;
      }
      setError(WITHDRAW_ERROR);
    } catch {
      setError(WITHDRAW_ERROR);
    } finally {
      setBusy(false);
    }
  }

  // Every purpose the practice can record, with the required ones first: the
  // list is the same on every record, so nothing has to be looked for twice,
  // and what this client still needs sits at the top.
  const purposes = [...CONSENT_PURPOSES].sort((a, b) => {
    const weight = (purpose: ConsentPurpose) => (required.has(purpose) ? 0 : 1);
    return weight(a) - weight(b);
  });

  return (
    <div className="tab-section">
      {outcome ? <Note>{outcome}</Note> : null}
      {consenting.length === 0 ? (
        <Note>
          No contact on this record may give consent yet. Set &ldquo;May give consent&rdquo; on the
          contact who will.
        </Note>
      ) : null}

      <ul className="record-rows">
        {purposes.map((purpose) => {
          const history = record.consents.filter((consent) => consent.purpose === purpose);
          const active = history.find((consent) => isActiveOn(consent, today, purpose));
          const isRequired = required.has(purpose);
          return (
            <li key={purpose} className="record-row">
              <div className="record-row__main">
                <p>{PURPOSE_LABELS[purpose] ?? purpose}</p>
                <p className="small muted">
                  {active
                    ? `On file since ${new Date(active.givenAt).toLocaleDateString('en-GB')}`
                    : isRequired
                      ? 'Needed before this client can be activated'
                      : 'Not recorded'}
                </p>
                {history.map((consent) => (
                  <div key={consent.id} className="consent-row__history small muted">
                    <span>{STATUS_LABELS[consent.status] ?? consent.status}</span>
                    <span>{METHOD_LABELS[consent.method] ?? consent.method}</span>
                    <span>Given by {nameOf(consent.givenByContactId)}</span>
                    <span>{new Date(consent.givenAt).toLocaleDateString('en-GB')}</span>
                    {consent.withdrawnAt ? (
                      <span>
                        Withdrawn {new Date(consent.withdrawnAt).toLocaleDateString('en-GB')}
                      </span>
                    ) : null}
                    {consent.signatureDocumentId ? (
                      <DocumentLink
                        clientId={clientId}
                        documentId={consent.signatureDocumentId}
                        label="Open what was signed"
                      />
                    ) : (
                      <span>No document filed</span>
                    )}
                  </div>
                ))}
              </div>
              {mayWrite ? (
                <div className="record-row__actions">
                  <Button
                    variant="quiet"
                    disabled={consenting.length === 0}
                    onClick={() => {
                      setRecording(purpose);
                      setWithdrawing(null);
                    }}
                  >
                    {active ? 'Record again' : 'Record'}
                  </Button>
                  {active ? (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setWithdrawing(active.id);
                        setRecording(null);
                        setReason('');
                      }}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {withdrawing ? (
        <div className="record-row__reason">
          <p className="small">
            Withdrawing takes effect at once. Appointments already in the diary are not cancelled by
            this — tell whoever keeps the schedule.
          </p>
          <Field
            id="withdraw-reason"
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Recorded against this withdrawal in the client's history."
          />
          <div className="drawer__actions">
            <Button variant="secondary" onClick={() => setWithdrawing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || reason.trim() === ''}
              onClick={() => void withdraw(withdrawing)}
            >
              {busy ? 'Withdrawing…' : 'Withdraw consent'}
            </Button>
          </div>
          {error ? <Note tone="critical">{error}</Note> : null}
        </div>
      ) : null}

      {recording ? (
        <RecordConsentForm
          // Keyed on the purpose: choosing a different consent is a fresh
          // form, so the wording, the pad and the read-to-the-end gate all
          // start again rather than one purpose's state leaking into another's.
          key={recording}
          clientId={clientId}
          record={record}
          purpose={recording}
          onSaved={() => {
            setRecording(null);
            onChanged();
          }}
          onCancel={() => setRecording(null)}
        />
      ) : null}
    </div>
  );
}
