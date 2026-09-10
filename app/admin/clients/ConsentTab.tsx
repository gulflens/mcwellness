import { useState, type ReactNode } from 'react';
import { OFFERED_CONSENT_PURPOSES, requiredConsentsFor, type ConsentPurpose } from '@domain/client';
import {
  WithdrawConsentResponse,
  type ClientRecordResponse,
  type Consent,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { practiceToday } from './activation';
import { contactDisplayName } from './contactName';
import { DocumentLink } from './DocumentLink';
import { RecordConsentForm } from './RecordConsentForm';

const PURPOSE_LABELS: Record<string, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  health_data: 'Brain-map and neurofeedback information',
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

/**
 * The heading of a panel that has just opened, which takes focus as it
 * appears.
 *
 * Both panels used to open at the foot of the tab, below six rows of
 * purposes and well under the fold, while focus stayed on the button that was
 * pressed. On a 900px screen that is a button that does nothing: the panel is
 * a thousand pixels away and nothing says it arrived. The panels now sit
 * inside the row whose consent they are about, and this puts the reader
 * inside them — which also gives a screen reader the panel's own name rather
 * than leaving it on a button whose meaning has changed.
 */
function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <h4
      className="drawer__section"
      tabIndex={-1}
      ref={(node) => {
        node?.focus();
      }}
    >
      {children}
    </h4>
  );
}

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
 * `requiredConsentsFor` in domain/client, so a guardian's consent appears the
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
  erased = false,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the consent routes would refuse: no recording, no withdrawal. */
  mayWrite: boolean;
  /**
   * Whether this record has been erased. Passed rather than read from
   * `record.status`, because the drawer knows it one act before the record
   * does (app/admin/clients/ClientDrawer.tsx).
   */
  erased?: boolean;
}) {
  const today = practiceToday();
  // As a set of plain strings: `requiredConsentsFor` answers with the purposes
  // activation can ask for, from the date of birth alone, and this list runs
  // over those the practice offers plus any retired one this household still
  // holds.
  const required = new Set<string>(
    requiredConsentsFor({ dateOfBirth: record.dateOfBirth }, ['home'], today),
  );
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
    // The same display helper the "Given by" dropdown uses (RecordConsentForm.tsx):
    // a nameless self contact — the one the enrolment wizard creates — reads as
    // the client's own name here too, rather than the bare relationship the form
    // that captured this consent no longer shows.
    const shown = contactDisplayName(contact, record);
    return shown === relationship ? shown : `${shown} (${relationship.toLowerCase()})`;
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
          setOutcome('Consent withdrawn.');
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

  // Every purpose the practice asks for, with the required ones first: the
  // list is the same on every record, so nothing has to be looked for twice,
  // and what this client still needs sits at the top.
  //
  // Plus any purpose this household has actually agreed to, even one the
  // practice has retired. `photo_video`, `research` and `marketing` are no
  // longer offered to anybody (docs/CONSENT/README.md, 2026-09-09), but a
  // household that agreed to one before then still did, and a consent screen
  // that hides an agreement somebody gave is a screen that lies about them.
  // They appear only where a row exists, so a fresh record shows four.
  const held = new Set(record.consents.map((consent) => consent.purpose));
  const offered = new Set<string>(OFFERED_CONSENT_PURPOSES);
  const purposes = [...new Set<ConsentPurpose>([...OFFERED_CONSENT_PURPOSES, ...held])].sort(
    (a, b) => {
      const weight = (purpose: ConsentPurpose) => (required.has(purpose) ? 0 : 1);
      return weight(a) - weight(b);
    },
  );

  return (
    <div className="tab-section">
      {erased || record.status === 'erased' ? (
        <Note tone="attention">
          This record has been erased. The consents below are what was agreed; nothing more can be
          recorded or withdrawn.
        </Note>
      ) : null}
      {/* tone="attention" carries role="status", so a confirmation reaches
          somebody who cannot see it land (app/shell/components/Controls.tsx). */}
      {outcome ? <Note tone="attention">{outcome}</Note> : null}
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
                    {/* Why it went, from the trail rather than a column: a
                        withdrawal always carries a reason and the tab that
                        asked for it is the tab that should show it back. */}
                    {consent.withdrawalReason ? (
                      <span>Reason: {consent.withdrawalReason}</span>
                    ) : null}
                    {consent.witnessedByName ? (
                      <span>Witnessed by {consent.witnessedByName}</span>
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
                    {/* The words, not only the signature. A person is entitled to
                        a copy of what they agreed to, and the exact version is on
                        the consent row, so the tab can name it rather than send
                        somebody to the current wording and hope. */}
                    <DocumentLink
                      clientId={clientId}
                      documentId={consent.textDocumentId}
                      label={
                        consent.wordingVersion === null
                          ? 'Open the wording'
                          : `Wording version ${consent.wordingVersion}`
                      }
                    />
                  </div>
                ))}
              </div>
              {mayWrite ? (
                <div className="record-row__actions">
                  {/* Recording is offered only for a purpose the practice still
                      asks for. A retired one appears on this row because the
                      household holds it and may withdraw it — but nothing may
                      take a NEW consent for a capability that no longer
                      exists, and staging still has photo-video wording loaded
                      that would otherwise let somebody file one. Migration
                      960's own reasoning: a guard with nothing left to guard
                      is a guard somebody later mistakes for permission. */}
                  {offered.has(purpose) ? (
                    <Button
                      variant="quiet"
                      disabled={consenting.length === 0}
                      onClick={() => {
                        setRecording(purpose);
                        setWithdrawing(null);
                        setOutcome(null);
                      }}
                    >
                      {active ? 'Record again' : 'Record'}
                    </Button>
                  ) : null}
                  {active ? (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setWithdrawing(active.id);
                        setRecording(null);
                        setReason('');
                        setOutcome(null);
                      }}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {/* Both panels open inside the row they are about, so pressing
                  Record or Withdraw changes the thing that was pressed rather
                  than something a thousand pixels below the fold. */}
              {active && withdrawing === active.id ? (
                <div className="record-row__reason">
                  <PanelHeading>
                    Withdraw consent: {(PURPOSE_LABELS[purpose] ?? purpose).toLowerCase()}
                  </PanelHeading>
                  <p className="small">
                    Withdrawing takes effect at once. Appointments already in the diary are not
                    cancelled by this — tell whoever keeps the schedule.
                  </p>
                  <Field
                    id="withdraw-reason"
                    label="Reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    hint="Recorded against this withdrawal in the client's history."
                  />
                  <div className="drawer__actions">
                    <Button
                      variant="secondary"
                      onClick={() => setWithdrawing(null)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy || reason.trim() === ''}
                      onClick={() => void withdraw(active.id)}
                    >
                      {busy ? 'Withdrawing…' : 'Withdraw consent'}
                    </Button>
                  </div>
                  {reason.trim() === '' ? (
                    <p className="small muted">A withdrawal is not recorded without a reason.</p>
                  ) : null}
                  {error ? <Note tone="critical">{error}</Note> : null}
                </div>
              ) : null}

              {recording === purpose ? (
                <RecordConsentForm
                  // Keyed on the purpose: choosing a different consent is a fresh
                  // form, so the wording, the pad and the read-to-the-end gate all
                  // start again rather than one purpose's state leaking into another's.
                  key={purpose}
                  clientId={clientId}
                  record={record}
                  purpose={purpose}
                  onSaved={() => {
                    setRecording(null);
                    setOutcome(`Consent recorded: ${PURPOSE_LABELS[purpose] ?? purpose}.`);
                    onChanged();
                  }}
                  onCancel={() => setRecording(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
