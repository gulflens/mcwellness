import { useState } from 'react';
import { blankInitial } from '../../../../domain/reports/qeeg/blank';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import type { ReportRow } from '../../../api/reports/schema';
import { Button, Note, Select } from '../../../shell/components/Controls';
import { comparableReports, earlierLabel } from './earlier';
import type { LoadPrefill, Prefilled } from './prefill';
import './qeeg.css';

/**
 * Starting a brain-map report from the client's Reports tab: a first report,
 * or a follow-up compared with one of the client's signed brain-map reports
 * or kept past records (docs/SPEC/reports-qeeg.md section 3).
 *
 * In the flow of the tab and not a dialog, as the report editor's own
 * confirmation is: one decision, read where she already is. A first report
 * starts blank, every score unset.
 *
 * **A follow-up starts from the report it is compared with** (brief S). Once
 * she has chosen it and starts, the prefill is asked for
 * (`GET /api/reports/qeeg/prefill`): the earlier scores and maps, what it is
 * compared with, the handedness and the sessions counted from the visits are
 * brought forward, every judgement is left empty, and what she chose last
 * time comes with it to be offered in the form. It is asked on Start and not
 * on every change of the list, because each asking is a read of the earlier
 * report on the trail. A refusal is said here, in its own sentence, and the
 * form does not open. Nothing is written until the report's first save.
 */
export function QeegStart({
  reports,
  prefill,
  onStart,
  onCancel,
}: {
  reports: readonly ReportRow[];
  /** Asks the server for a follow-up begun from an earlier report. */
  prefill: LoadPrefill;
  onStart: (start: QeegContent, prefilled: Prefilled | null) => void;
  onCancel: () => void;
}) {
  const candidates = comparableReports(reports);
  const [edition, setEdition] = useState<'initial' | 'follow-up'>('initial');
  const [earlierId, setEarlierId] = useState(candidates[0]?.id ?? '');
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const earlier = candidates.find((row) => row.id === earlierId) ?? null;

  async function start(): Promise<void> {
    if (edition === 'initial') {
      onStart(blankInitial(), null);
      return;
    }
    if (earlier === null) return;
    setAsking(true);
    setRefusal(null);
    const answer = await prefill({ from: earlier.id });
    setAsking(false);
    if (!answer.ok) {
      setRefusal(answer.sentence);
      return;
    }
    onStart(answer.prefilled.content, answer.prefilled);
  }

  return (
    <div className="qeeg-start" role="group" aria-label="New brain-map report">
      <fieldset>
        <legend className="report-editor__heading">New brain-map report</legend>
        <label className="checkbox">
          <input
            type="radio"
            name="qeeg-edition"
            checked={edition === 'initial'}
            onChange={() => setEdition('initial')}
          />
          <span>First report</span>
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="qeeg-edition"
            checked={edition === 'follow-up'}
            onChange={() => setEdition('follow-up')}
          />
          <span>Follow-up, compared with an earlier report</span>
        </label>
      </fieldset>
      {edition === 'follow-up' ? (
        candidates.length === 0 ? (
          <Note>
            This client has no signed brain-map report and no kept past record, so there is nothing
            for a follow-up to be compared with yet.
          </Note>
        ) : (
          <Select
            id="qeeg-start-earlier"
            label="Compared with"
            hint="The client’s first report is chosen to begin with."
            value={earlierId}
            onChange={(event) => {
              setEarlierId(event.currentTarget.value);
              setRefusal(null);
            }}
          >
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {earlierLabel(row)}
              </option>
            ))}
          </Select>
        )
      ) : null}
      {edition === 'follow-up' && refusal !== null ? <Note tone="critical">{refusal}</Note> : null}
      {/* Always there, so what it comes to say is announced. */}
      <p id="qeeg-start-status" className="small muted" role="status" aria-live="polite">
        {asking ? 'Reading the earlier report.' : ''}
      </p>
      <div className="report-editor__actions">
        <Button
          variant="primary"
          disabled={asking || (edition === 'follow-up' && earlier === null)}
          onClick={() => void start()}
        >
          Start the report
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
