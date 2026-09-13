import { useState, type FormEvent } from 'react';
import {
  HEALTH_QUESTIONS,
  IdResponse,
  type ClientRecordResponse,
  type HealthDeclaration,
  type HealthQuestion,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { isActiveOn } from './ConsentTab';
import { Textarea } from './FormAtoms';
import { practiceToday } from './activation';

/**
 * The six questions in the agreement's own words (docs/CONSENT/agreement.en.md).
 * Recorded as told, never assessed: this is a wellness practice, and the point
 * of asking is that the person at the door is not surprised (CLAUDE.md rule 1;
 * docs/SPEC/client-record.md section 4.6).
 */
const QUESTIONS: Record<HealthQuestion, string> = {
  seizures: 'Epilepsy or any seizure',
  implantedDevice: 'A pacemaker or any implanted electrical device',
  headInjury: 'A head injury at any time',
  pregnancy: 'Pregnancy',
  medication: 'Medication that affects mood, sleep or attention',
  scalp: 'A skin condition or sensitivity on the scalp',
};
const NOTE_OF: Record<HealthQuestion, keyof HealthDeclaration> = {
  seizures: 'seizuresNote',
  implantedDevice: 'implantedDeviceNote',
  headInjury: 'headInjuryNote',
  pregnancy: 'pregnancyNote',
  medication: 'medicationNote',
  scalp: 'scalpNote',
};

type Answers = Partial<Record<HealthQuestion, boolean>>;
type Notes = Partial<Record<HealthQuestion, string>>;

const GENERIC_ERROR = 'The answers could not be saved. Try again.';
const FORBIDDEN_ERROR = 'Only the owner, an admin or the lead practitioner may record these.';
const CONSENT_ERROR = "Record the household's health-data consent first.";
const INCOMPLETE_ERROR = 'Answer every question. "We did not ask" is not the same as "no".';

/**
 * The health answers (docs/SPEC/client-record.md section 4.6): what the
 * household has told the practice, as last told, and the form that records a
 * fresh set. The drawer's tab and the enrolment wizard's Health step are the
 * same component, because they are the same job at two moments — as the
 * Consent tab already is.
 *
 * **A change is a new row**, never an edit: the form always posts all six,
 * and the tab shows the newest. **Only under a standing `health_data`
 * consent**: the route refuses otherwise (409), and this tab says so in a
 * sentence and offers no form rather than letting somebody fill in six
 * answers to be told "no" at the end — which is also why the wizard asks
 * these after its Consent step. **All six are required**: "we did not ask" is
 * not "no", so an unanswered question stops the save rather than defaulting.
 */
export function HealthTab({
  clientId,
  record,
  onChanged,
  mayWrite,
  erased = false,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the route would refuse: read the answers, record nothing. */
  mayWrite: boolean;
  /** Passed rather than read from `record.status`, for the reason GoalsTab gives. */
  erased?: boolean;
}) {
  const { apiFetch } = useAuth();
  const today = practiceToday();
  const consented = record.consents.some((consent) => isActiveOn(consent, today, 'health_data'));
  const current = record.health;
  const isErased = erased || record.status === 'erased';
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [notes, setNotes] = useState<Notes>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function cancel() {
    setAsking(false);
    setAnswers({});
    setNotes({});
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (HEALTH_QUESTIONS.some((question) => answers[question] === undefined)) {
      setError(INCOMPLETE_ERROR);
      return;
    }
    const body: Record<string, unknown> = {};
    for (const question of HEALTH_QUESTIONS) {
      body[question] = answers[question];
      const note = (notes[question] ?? '').trim();
      if (answers[question] && note) body[`${question}Note`] = note;
    }
    // Which version of the agreement asked: the participation wording the
    // household signed, which is where the six questions are printed. Left
    // out when none stands, and the record shows the answers without it.
    const agreement = record.consents.find(
      (consent) =>
        isActiveOn(consent, today, 'participation') ||
        isActiveOn(consent, today, 'minor_participation'),
    );
    if (agreement?.wordingVersion) body.wordingVersion = agreement.wordingVersion;

    setBusy(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/health`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        IdResponse.parse(await res.json());
        cancel();
        onChanged();
        return;
      }
      setError(
        res.status === 409 ? CONSENT_ERROR : res.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR,
      );
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-section">
      {isErased ? (
        <Note tone="attention">This record has been erased. The health answers went with it.</Note>
      ) : null}
      <p className="small muted">
        The six things the agreement asks every household to tell the practice before the first
        session, and if they change. Written down as told; nothing here is assessed.
      </p>
      {current === null ? (
        <Note>Not asked yet.</Note>
      ) : (
        <>
          <p className="small muted">
            Asked on{' '}
            <span className="numeric">{new Date(current.askedAt).toLocaleDateString('en-GB')}</span>
            {current.wordingVersion ? ` under agreement ${current.wordingVersion}` : ''}.
          </p>
          <ul className="record-rows" aria-label="Health answers">
            {HEALTH_QUESTIONS.map((question) => {
              const yes = current[question];
              const note = current[NOTE_OF[question]];
              return (
                <li key={question} className="record-row">
                  <div className="record-row__main">
                    <p>{QUESTIONS[question]}</p>
                    {typeof note === 'string' && note ? (
                      <p className="small muted">{note}</p>
                    ) : null}
                  </div>
                  <span
                    className={yes ? 'health__answer health__answer--yes' : 'health__answer muted'}
                  >
                    {yes ? 'Yes' : 'No'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!mayWrite || isErased ? null : !consented ? (
        <Note tone="attention">
          These are held under the household&rsquo;s health-data consent, which is not on file.
          Record it on the Consent tab first.
        </Note>
      ) : !asking ? (
        <Button variant="secondary" onClick={() => setAsking(true)}>
          {current === null ? 'Record the answers' : 'Record a change'}
        </Button>
      ) : (
        <form className="drawer__form" onSubmit={(e) => void submit(e)}>
          {HEALTH_QUESTIONS.map((question) => (
            <fieldset key={question} className="health__question">
              <legend>{QUESTIONS[question]}</legend>
              <div className="health__choices">
                <label htmlFor={`health-${question}-yes`} className="checkbox">
                  <input
                    id={`health-${question}-yes`}
                    type="radio"
                    name={`health-${question}`}
                    checked={answers[question] === true}
                    onChange={() => setAnswers((prev) => ({ ...prev, [question]: true }))}
                  />
                  <span>Yes</span>
                </label>
                <label htmlFor={`health-${question}-no`} className="checkbox">
                  <input
                    id={`health-${question}-no`}
                    type="radio"
                    name={`health-${question}`}
                    checked={answers[question] === false}
                    onChange={() => setAnswers((prev) => ({ ...prev, [question]: false }))}
                  />
                  <span>No</span>
                </label>
              </div>
              {answers[question] === true ? (
                <Textarea
                  id={`health-${question}-note`}
                  label="Anything to note (optional)"
                  rows={2}
                  value={notes[question] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNotes((prev) => ({ ...prev, [question]: value }));
                  }}
                />
              ) : null}
            </fieldset>
          ))}
          {error ? <Note tone="critical">{error}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save the answers'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
