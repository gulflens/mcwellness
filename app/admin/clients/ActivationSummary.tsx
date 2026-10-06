import type { Missing } from '@domain/client';
import { Note } from '../../shell/components/Controls';
import { missingLabel } from './activation';

/**
 * What is still missing before a lead can be activated (docs/SPEC/client-record.md
 * section 3, rule 1), in plain words. The same list on every enrolment step and on
 * the drawer's Overview, so the answer never depends on which screen asked: it is
 * `canActivate` on the record the server last returned, never a local guess.
 * Consents are listed apart (`consentsOutstanding`): no bar to activation, but
 * still to sign before the first visit starts (the check-in refuses it).
 */
export function ActivationSummary({
  missing,
  toSign = [],
  activated = false,
  heading = 'Still to complete before this client can be activated',
}: {
  missing: readonly Missing[];
  /** Consents still to sign: no bar to activation, signed at the first visit at the latest. */
  toSign?: readonly Missing[];
  /** An active client: only the consents still to sign are worth saying. */
  activated?: boolean;
  heading?: string;
}) {
  const later =
    toSign.length === 0 ? null : (
      <div className="activation-summary">
        <p className="small muted">To sign at the first visit</p>
        <ul className="record-facts__list small">
          {toSign.map((item) => (
            <li key={item}>{missingLabel(item)}</li>
          ))}
        </ul>
      </div>
    );
  if (activated) {
    return later;
  }
  if (missing.length === 0) {
    return (
      <>
        <Note>Everything needed to activate this client is on file.</Note>
        {later}
      </>
    );
  }
  return (
    <>
      <div className="activation-summary">
        {heading ? <p className="small muted">{heading}</p> : null}
        <ul className="record-facts__list small">
          {missing.map((item) => (
            <li key={item}>{missingLabel(item)}</li>
          ))}
        </ul>
      </div>
      {later}
    </>
  );
}
