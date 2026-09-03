import { requiredConsents, type ConsentPurpose } from '@domain/client';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { Note } from '../../shell/components/Controls';
import { practiceToday, toActivationRecord } from './activation';

const PURPOSE_LABELS: Record<string, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a minor",
  home_visit: 'Home visits',
  photo_video: 'Photo and video',
  research: 'Research',
  marketing: 'Marketing',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  superseded: 'Superseded',
};
const METHOD_LABELS: Record<string, string> = {
  app_signature: 'Signed in the app',
  paper_scan: 'Paper form on file',
  verbal_witnessed: 'Recorded verbally, witnessed',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

function isActiveOn(
  consent: ClientRecordResponse['consents'][number],
  today: string,
  purpose: ConsentPurpose,
): boolean {
  return (
    consent.purpose === purpose &&
    consent.status === 'active' &&
    (consent.expiresAt === null || consent.expiresAt > today)
  );
}

/**
 * Consent, read-only this pull request (docs/SPEC/client-record.md section
 * 4.2, and the drawer's Consent tab doubles as the enrolment wizard's
 * consent step). Two parts: what this client needs before activation, from
 * `requiredConsents` in domain/client — so a minor's guardian consent
 * appears the moment a date of birth makes the client a minor — and every
 * consent already recorded.
 *
 * Recording one is deliberately not built here. The route needs the exact
 * wording that was shown (`consent.text_document_id`, a practice document),
 * and every method it accepts for initial participation attests to evidence
 * this stream cannot yet capture or file: `app_signature` needs a
 * signature drawn on screen, `paper_scan` needs the scan uploaded, and
 * `verbal_witnessed` is never allowed for initial participation (section 7).
 * Weakening the route to record an unevidenced consent would be worse than
 * waiting, so the fourth pull request brings it with documents; the exact
 * shape it needs is written down in
 * docs/CHANGE-REQUESTS/client-record-02.md.
 */
export function ConsentTab({ record }: { record: ClientRecordResponse }) {
  const today = practiceToday();
  const required = requiredConsents(toActivationRecord(record), ['home'], today);
  const consenting = record.contacts.filter((contact) => contact.canConsent);

  return (
    <div className="tab-section">
      <h3 className="drawer__section">What this client needs</h3>
      <ul className="record-facts__list small">
        {required.map((purpose) => {
          const onFile = record.consents.some((consent) => isActiveOn(consent, today, purpose));
          return (
            <li key={purpose} className="record-facts__pair">
              <span>{PURPOSE_LABELS[purpose] ?? purpose}</span>
              <span className="muted">{onFile ? 'On file' : 'Not yet recorded'}</span>
            </li>
          );
        })}
      </ul>
      {consenting.length === 0 ? (
        <Note>
          No contact on this record may give consent yet. Set &ldquo;May give consent&rdquo; on the
          contact who will.
        </Note>
      ) : (
        <p className="small muted">
          {consenting.length === 1 ? 'This contact may consent: ' : 'These contacts may consent: '}
          {consenting
            .map((contact) => RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship)
            .join(', ')}
          .
        </p>
      )}

      <h3 className="drawer__section">Recorded</h3>
      {record.consents.length === 0 ? (
        <Note>No consent recorded yet.</Note>
      ) : (
        <ul className="record-rows">
          {record.consents.map((consent) => (
            <li key={consent.id} className="record-row">
              <div className="record-row__main">
                <p>{PURPOSE_LABELS[consent.purpose] ?? consent.purpose}</p>
                <p className="small muted">{STATUS_LABELS[consent.status] ?? consent.status}</p>
                <p className="small muted">{METHOD_LABELS[consent.method] ?? consent.method}</p>
                <p className="small muted">
                  Given {new Date(consent.givenAt).toLocaleDateString('en-GB')}
                </p>
                {consent.withdrawnAt ? (
                  <p className="small muted">
                    Withdrawn {new Date(consent.withdrawnAt).toLocaleDateString('en-GB')}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Note>Recording consent arrives with documents.</Note>
    </div>
  );
}
