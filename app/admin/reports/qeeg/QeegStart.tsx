import { useState } from 'react';
import { blankFollowUp, blankInitial } from '../../../../domain/reports/qeeg/blank';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import type { ReportRow } from '../../../api/reports/schema';
import { Button, Note, Select } from '../../../shell/components/Controls';
import { comparableReports, comparedFromRow, earlierLabel } from './earlier';
import './qeeg.css';

/**
 * Starting a brain-map report from the client's Reports tab: a first report,
 * or a follow-up compared with one of the client's signed brain-map reports
 * or kept past records (docs/SPEC/reports-qeeg.md section 3).
 *
 * In the flow of the tab and not a dialog, as the report editor's own
 * confirmation is: one decision, read where she already is. The report starts
 * blank, every score unset; nothing is written until its first save.
 */
export function QeegStart({
  reports,
  onStart,
  onCancel,
}: {
  reports: readonly ReportRow[];
  onStart: (start: QeegContent) => void;
  onCancel: () => void;
}) {
  const candidates = comparableReports(reports);
  const [edition, setEdition] = useState<'initial' | 'follow-up'>('initial');
  const [earlierId, setEarlierId] = useState(candidates[0]?.id ?? '');
  const earlier = candidates.find((row) => row.id === earlierId) ?? null;

  function start(): void {
    if (edition === 'initial') {
      onStart(blankInitial());
      return;
    }
    if (earlier === null) return;
    onStart(blankFollowUp(comparedFromRow(earlier), 'follow_up'));
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
            onChange={(event) => setEarlierId(event.currentTarget.value)}
          >
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {earlierLabel(row)}
              </option>
            ))}
          </Select>
        )
      ) : null}
      <div className="report-editor__actions">
        <Button
          variant="primary"
          disabled={edition === 'follow-up' && earlier === null}
          onClick={start}
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
