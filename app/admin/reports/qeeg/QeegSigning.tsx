import { useEffect, useRef, useState, type RefObject } from 'react';
import { displayFromIso } from '@domain/shared';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import { Button, Note } from '../../../shell/components/Controls';
import { Textarea } from '../../clients/FormAtoms';
import { layoutLines } from './layoutNotes';
import { missingWords } from './sections';
import type { Signing } from './useQeegSigning';

/**
 * The foot of the brain-map form: Preview and Sign, and what each answers
 * (docs/SPEC/reports-qeeg.md sections 12, 14 and 15); and, once signed, the
 * report as it now stands, read only, with its file and a way to correct it.
 *
 * **What the pages told the editor sits beside the Preview button**: how many
 * pages, the dashboard's scale, what runs over, what the typeface cannot
 * draw, and how each map will print (`layoutNotes.ts`). It stays until the
 * next preview, so she can read it while she works.
 *
 * **Signing is a step inside the form**, never the browser's own dialog: a
 * region, headed, that takes focus when it opens and gives it back to the
 * button that opened it when it closes (as does the correction's panel). It
 * says what signing means, with the Preview button beside the
 * signature, as the older report editor has it. A refusal is shown in that
 * panel, with the list of what is left to fill when that is why.
 *
 * **A signed report is read, not edited** (rule 7). Correcting it asks for a
 * reason in the form and starts a new version as a draft, which the form then
 * opens.
 */

/**
 * Focus into a panel when it opens, and back to the button that opened it
 * when it closes, so a keyboard or a screen reader follows the step. Only a
 * change moves focus: the first render moves nothing.
 */
function useFocusOnToggle(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  opener: RefObject<HTMLElement | null>,
): void {
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    (open ? panel.current : opener.current)?.focus();
  }, [open, panel, opener]);
}

export function SigningActions({
  signing,
  content,
  mayOffer,
  busy,
}: {
  signing: Signing;
  content: QeegContent;
  /** The person holds a certificate that lets them sign; otherwise it is said why not. */
  mayOffer: boolean;
  /** A save or a door is on its way. */
  busy: boolean;
}) {
  const lines = signing.notes === null ? [] : layoutLines(signing.notes, content);
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnToggle(signing.confirming, panelRef, openerRef);
  const idle = !busy && !signing.previewing && !signing.signing;
  return (
    <div className="qeeg-signing">
      <div className="report-editor__actions">
        <Button disabled={!idle} onClick={() => void signing.preview()}>
          {signing.previewing ? 'Making the preview.' : 'Preview'}
        </Button>
        {mayOffer ? (
          <Button ref={openerRef} variant="primary" disabled={!idle} onClick={signing.askToSign}>
            Sign this report
          </Button>
        ) : null}
      </div>
      {!mayOffer ? (
        <Note>
          A report is signed by a practitioner whose certificate says so. Yours does not, so this
          stays a draft for somebody who can sign it.
        </Note>
      ) : null}

      <div className="qeeg-signing__notes" role="status" aria-live="polite">
        {signing.previewError ? <Note tone="critical">{signing.previewError}</Note> : null}
        {signing.previewUrl !== null && signing.previewError === null ? (
          <p className="small">
            The preview is ready. If no tab opened, open it here:{' '}
            <a href={signing.previewUrl} target="_blank" rel="noopener noreferrer">
              Open the preview
            </a>
          </p>
        ) : null}
        {lines.length > 0 ? (
          <ul className="qeeg-signing__lines small" aria-label="What the preview found">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {signing.confirming ? (
        <div
          ref={panelRef}
          className="report-editor__sign"
          role="region"
          aria-labelledby="qeeg-sign-title"
          tabIndex={-1}
        >
          <h4 id="qeeg-sign-title" className="report-editor__heading">
            Sign this report
          </h4>
          <p>
            Signing this puts your name on it. It becomes a document the household can keep, and it
            cannot be edited afterwards. A mistake is corrected by starting a new version, and both
            are kept. Its maps are kept with it, as they are.
          </p>
          {signing.signError ? <Note tone="critical">{signing.signError}</Note> : null}
          {signing.missing.length > 0 ? (
            <ul className="qeeg-signing__missing small" aria-label="Still to fill">
              {signing.missing.map((each) => (
                <li key={`${each.section} ${each.what}`}>{missingWords(each, content.edition)}</li>
              ))}
            </ul>
          ) : null}
          <div className="report-editor__actions">
            <Button disabled={!idle} onClick={() => void signing.preview()}>
              See the pages first
            </Button>
            <Button variant="primary" disabled={!idle} onClick={() => void signing.sign()}>
              {signing.signing ? 'Signing.' : 'Sign and issue'}
            </Button>
            <Button variant="quiet" disabled={signing.signing} onClick={signing.notYet}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SignedReport({
  signing,
  mayCorrect,
  onCorrected,
  onDone,
}: {
  signing: Signing;
  /** The owner or the lead practitioner: the two who may replace a signed version. */
  mayCorrect: boolean;
  onCorrected: (draftId: string) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusOnToggle(signing.correcting, panelRef, openerRef);
  const row = signing.signed;
  if (row === null) return null;

  async function correct(): Promise<void> {
    setSending(true);
    try {
      const id = await signing.correct(reason);
      if (id !== null) onCorrected(id);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="report-editor qeeg-editor">
      <header className="qeeg-editor__head">
        <h3 className="report-editor__heading">Brain-map report, signed</h3>
        <p className="small muted" role="status">
          Signed. It can no longer be changed.
        </p>
      </header>
      <dl className="qeeg-signed">
        <dt>Reference</dt>
        <dd>{row.reference ?? ''}</dd>
        <dt>Signed on</dt>
        <dd>{row.issuedOn === null ? '' : displayFromIso(row.issuedOn)}</dd>
        <dt>Signed by</dt>
        <dd>{row.signedByName ?? ''}</dd>
        <dt>Version</dt>
        <dd className="numeric">{row.version}</dd>
      </dl>
      {signing.openError ? <Note tone="critical">{signing.openError}</Note> : null}
      {signing.signedUrl !== null && signing.openError === null ? (
        <p className="small" role="status">
          The signed report is ready. If no tab opened, open it here:{' '}
          <a href={signing.signedUrl} target="_blank" rel="noopener noreferrer">
            Open the signed file
          </a>
        </p>
      ) : null}
      <div className="report-editor__actions">
        <Button
          variant="primary"
          disabled={signing.opening}
          onClick={() => void signing.openSigned()}
        >
          Open the signed report
        </Button>
        {mayCorrect ? (
          <Button ref={openerRef} disabled={signing.correcting} onClick={signing.askToCorrect}>
            Correct this report
          </Button>
        ) : null}
        <Button variant="quiet" onClick={onDone}>
          Back
        </Button>
      </div>
      {signing.correcting ? (
        <div
          ref={panelRef}
          className="report-editor__sign"
          role="region"
          aria-labelledby="qeeg-correct-title"
          tabIndex={-1}
        >
          <h4 id="qeeg-correct-title" className="report-editor__heading">
            Correct this report
          </h4>
          <p>
            A correction starts a new version as a draft, from what was signed, with its maps. This
            version stays as it is, marked as replaced, and both are kept.
          </p>
          <Textarea
            id="qeeg-correct-reason"
            label="Why it is being corrected"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          {signing.correctError ? <Note tone="critical">{signing.correctError}</Note> : null}
          <div className="report-editor__actions">
            <Button variant="primary" disabled={sending} onClick={() => void correct()}>
              Start a corrected version
            </Button>
            <Button variant="quiet" disabled={sending} onClick={signing.notNow}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
