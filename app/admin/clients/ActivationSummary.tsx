import type { Missing } from '@domain/client';
import { Note } from '../../shell/components/Controls';
import { missingLabel } from './activation';

/**
 * What is still missing before a lead can be activated (docs/SPEC/client-record.md
 * section 3, rule 1), in plain words. The same list on every enrolment step and on
 * the drawer's Overview, so the answer never depends on which screen asked: it is
 * `canActivate` on the record the server last returned, never a local guess.
 */
export function ActivationSummary({
  missing,
  heading = 'Still to complete before this client can be activated',
}: {
  missing: readonly Missing[];
  heading?: string;
}) {
  if (missing.length === 0) {
    return <Note>Everything needed to activate this client is on file.</Note>;
  }
  return (
    <div className="activation-summary">
      {heading ? <p className="small muted">{heading}</p> : null}
      <ul className="record-facts__list small">
        {missing.map((item) => (
          <li key={item}>{missingLabel(item)}</li>
        ))}
      </ul>
    </div>
  );
}
