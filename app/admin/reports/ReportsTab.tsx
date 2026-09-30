import { Fragment, useState } from 'react';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import type { ReportRow } from '../../api/reports/schema';
import type { QeegContent } from '../../../domain/reports/qeeg/types';
import { editorKindFor, kindWord, statusTone, statusWord } from './kinds';
import { ReportEditor } from './ReportEditor';
import { ReportView } from './ReportView';
import { QeegEditor } from './qeeg/QeegEditor';
import { QeegStart } from './qeeg/QeegStart';
import { usePrefill, type Prefilled } from './qeeg/prefill';
import { PastRecordImport } from './qeeg/PastRecordImport';
import { PastRecordView } from './qeeg/PastRecordView';
import { languageWord, twinLines } from './qeeg/twinWords';
import {
  canDeliverReports,
  canDraftReports,
  canImportReports,
  canSupersedeReports,
} from './reportsAccess';
import { inChains, useReports } from './useReports';
import './reports.css';

/**
 * The Reports tab on the client record (docs/SPEC/reports-v1.md section 4.1):
 * reference, kind, coverage, status, signer, and whether it has been
 * delivered. Superseded versions sit beneath the ones that replaced them.
 *
 * A table, not cards: reports are homogeneous rows and the console's own table
 * already carries the sticky head, the hairline rules and the tabular figures
 * (docs/DESIGN-BRIEF.md section 6.2). Written out rather than through the
 * shared `Table` because the arrangement needs a row to carry a class of its
 * own — a superseded version is drawn quiet and indented beneath its
 * successor, which is the whole of what makes a chain readable.
 *
 * Three things open from here: **Write a report**, which is the draft editor
 * for whichever kind was chosen; a row, which opens the report itself; and
 * nothing else. A brain-map report has a form of its own
 * (`qeeg/QeegEditor.tsx`), started as a first report or a follow-up, and a
 * brain-map draft row opens there. Signing, superseding and sending all live inside those two,
 * beside the thing they act on. A brain map says which language it is in,
 * and names its other language and whether it is out of step
 * (`qeeg/twinWords.ts`), beneath its reference.
 *
 * **A past record** from the practice's old tool (docs/SPEC/reports-qeeg.md
 * section 11) is brought in from here, by the owner and the lead practitioner
 * ("Bring in a past record", `qeeg/PastRecordImport.tsx`), and opens
 * read-only as "Past record" (`qeeg/PastRecordView.tsx`), withdrawn there by
 * the same two. One brought in and not yet kept opens the import again, to be
 * finished with the same file.
 *
 * **A draft opens in the editor, not the viewer.** Every row used to open in
 * `ReportView`, which offers a draft no edit, no preview and no signature — so
 * a saved draft, and every correction started by "Correct this report", could
 * be finished only through the API. A draft row lands in the editor loaded
 * with what was saved, and a supersede hands its corrected draft straight
 * there, which is what section 4.3 describes.
 */

function coverageOf(report: ReportRow): string {
  if (report.coverageFrom && report.coverageTo) {
    return `${report.coverageFrom} to ${report.coverageTo}`;
  }
  return report.issuedOn ?? '';
}

function Row({
  report,
  reports,
  beneath = false,
  onOpen,
}: {
  report: ReportRow;
  /** Every row, so a brain map's other language is named by its reference. */
  reports: readonly ReportRow[];
  beneath?: boolean;
  onOpen: (report: ReportRow) => void;
}) {
  const language = languageWord(report);
  return (
    <tr className={beneath ? 'reports__row--superseded' : undefined}>
      <td>
        <button type="button" className="link" onClick={() => onOpen(report)}>
          {report.pastRecord ? 'Past record' : (report.reference ?? 'Not yet signed')}
        </button>
        {beneath && report.amendmentReason ? (
          <span className="reports__reason small">Replaced: {report.amendmentReason}</span>
        ) : null}
        {twinLines(report, reports).map((line) => (
          <span key={line} className="reports__reason small">
            {line}
          </span>
        ))}
      </td>
      <td>{language === null ? kindWord(report.kind) : `${kindWord(report.kind)}, ${language}`}</td>
      <td className="numeric">{coverageOf(report)}</td>
      <td>
        <StatusChip
          label={
            report.withdrawn
              ? 'Withdrawn'
              : report.pastRecord && report.status === 'draft'
                ? 'Being brought in'
                : statusWord(report.status)
          }
          tone={statusTone(report.status)}
        />
      </td>
      <td>{report.signedByName ?? ''}</td>
      <td className="numeric">
        {/* Whether a household has it, in words. A count would invite somebody
            to read a report sent twice as a report sent better. */}
        {report.deliveries === 0 ? 'Not sent' : 'Sent'}
      </td>
    </tr>
  );
}

export function ReportsTab({
  clientId,
  erased = false,
}: {
  clientId: string;
  /**
   * Whether this record has been erased. Passed rather than read back from the
   * server, because the drawer knows it one act before the record does
   * (app/admin/clients/ClientDrawer.tsx).
   */
  erased?: boolean;
}) {
  const { session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  const now = new Date();
  const { state, refetch } = useReports(clientId);
  /** The kind being written, or null when nothing is. */
  const [writing, setWriting] = useState<'session' | 'progress' | null>(null);
  /** The draft being edited, if the editor was opened on one. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Choosing which brain-map report to start. */
  const [startingQeeg, setStartingQeeg] = useState(false);
  /** Bringing in a past record from the old tool; `resuming` when one was left as a draft. */
  const [importing, setImporting] = useState<{ resuming: boolean } | null>(null);
  /** The past record open read-only. */
  const [pastId, setPastId] = useState<string | null>(null);
  /** The brain-map report being written: a draft to open, or a blank to start. */
  const [qeeg, setQeeg] = useState<{
    reportId: string | null;
    start: QeegContent | null;
    /** A follow-up begun from an earlier report: what came with it (brief S). */
    prefilled: Prefilled | null;
  } | null>(null);
  const loadPrefill = usePrefill(clientId);

  const mayWrite = canDraftReports(actor, now, clientId) && !erased;
  const maySupersede = canSupersedeReports(actor, now, clientId) && !erased;
  const maySend = canDeliverReports(actor, now) && !erased;
  const mayImport = canImportReports(actor, now, clientId) && !erased;

  if (state.kind === 'loading') return <Note>Loading.</Note>;
  if (state.kind === 'error') return <Note tone="critical">The reports could not be loaded.</Note>;

  function closeEditor(): void {
    setWriting(null);
    setDraftId(null);
    void refetch();
  }

  if (importing !== null) {
    return (
      <>
        {importing.resuming ? (
          <Note>
            This record was brought in and not yet kept. Choose the same file again to finish.
          </Note>
        ) : null}
        <PastRecordImport
          clientId={clientId}
          onDone={(id) => {
            setImporting(null);
            setPastId(id);
            void refetch();
          }}
          onCancel={() => {
            setImporting(null);
            void refetch();
          }}
        />
      </>
    );
  }

  if (pastId !== null) {
    return (
      <PastRecordView
        reportId={pastId}
        mayWithdraw={mayImport}
        onBack={() => {
          setPastId(null);
          void refetch();
        }}
      />
    );
  }

  if (qeeg !== null) {
    return (
      <QeegEditor
        // A corrected version is another draft: the form starts afresh on it.
        key={qeeg.reportId ?? 'new'}
        clientId={clientId}
        reportId={qeeg.reportId}
        start={qeeg.start}
        prefilled={qeeg.prefilled}
        prefill={loadPrefill}
        reports={state.reports}
        erased={erased}
        onDone={() => {
          setQeeg(null);
          void refetch();
        }}
        onCorrected={(id) => {
          setQeeg({ reportId: id, start: null, prefilled: null });
          void refetch();
        }}
      />
    );
  }

  if (writing !== null) {
    return (
      <ReportEditor
        clientId={clientId}
        kind={writing}
        reportId={draftId}
        onDone={closeEditor}
        onCancel={closeEditor}
      />
    );
  }

  if (openId !== null) {
    return (
      <ReportView
        reportId={openId}
        reports={state.reports}
        mayDraft={mayWrite}
        maySupersede={maySupersede}
        maySend={maySend}
        onTwinStarted={(id) => {
          // The other language of a signed brain map opens in its own form.
          setOpenId(null);
          setQeeg({ reportId: id, start: null, prefilled: null });
        }}
        onBack={() => {
          setOpenId(null);
          void refetch();
        }}
        onSuperseded={(id, superseded) => {
          // Straight into the editor on the corrected draft: a correction the
          // practitioner cannot then read over and sign is a correction that
          // only the API can finish.
          setOpenId(null);
          switch (superseded) {
            case 'qeeg':
              // A brain map's corrected draft opens in its own form.
              setQeeg({ reportId: id, start: null, prefilled: null });
              return;
            case 'session':
            case 'progress':
              setDraftId(id);
              setWriting(superseded);
              return;
            default: {
              const unknown: never = superseded;
              return unknown;
            }
          }
        }}
      />
    );
  }

  /**
   * A draft is edited; anything signed is read. A brain-map draft opens in
   * the brain-map form.
   */
  function open(report: ReportRow): void {
    if (report.pastRecord) {
      // Brought in from the old tool: finished through the import, else read.
      if (report.status === 'draft' && mayImport) {
        setImporting({ resuming: true });
        return;
      }
      setPastId(report.id);
      return;
    }
    if (report.kind === 'qeeg' && report.status === 'draft' && mayWrite) {
      setQeeg({ reportId: report.id, start: null, prefilled: null });
      return;
    }
    const editor = editorKindFor(report.kind);
    if (report.status === 'draft' && mayWrite && editor !== null) {
      setDraftId(report.id);
      setWriting(editor);
      return;
    }
    setOpenId(report.id);
  }

  const chains = inChains(state.reports);

  return (
    <div className="tab-section">
      {mayWrite ? (
        <div className="report-editor__actions">
          <Button variant="primary" onClick={() => setWriting('progress')}>
            Write a progress report
          </Button>
          <Button onClick={() => setWriting('session')}>Write a session report</Button>
          <Button onClick={() => setStartingQeeg(true)}>New brain-map report</Button>
          {mayImport ? (
            <Button onClick={() => setImporting({ resuming: false })}>
              Bring in a past record
            </Button>
          ) : null}
        </div>
      ) : null}

      {mayWrite && startingQeeg ? (
        <QeegStart
          reports={state.reports}
          prefill={loadPrefill}
          onStart={(start, prefilled) => {
            setStartingQeeg(false);
            setQeeg({ reportId: null, start, prefilled });
          }}
          onCancel={() => setStartingQeeg(false)}
        />
      ) : null}

      {chains.length === 0 ? (
        <Note>
          {erased
            ? 'This record has been erased. Nothing is held about it any more.'
            : 'No reports have been written for this client yet.'}
        </Note>
      ) : (
        <div className="ledger__scroll">
          <table className="ledger">
            <caption className="visually-hidden">Reports for this client</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Kind</th>
                <th scope="col" className="numeric">
                  Covers
                </th>
                <th scope="col">Status</th>
                <th scope="col">Signed by</th>
                <th scope="col" className="numeric">
                  Sent
                </th>
              </tr>
            </thead>
            <tbody>
              {chains.map(({ head, superseded }) => (
                <Fragment key={head.id}>
                  <Row report={head} reports={state.reports} onOpen={open} />
                  {superseded.map((older) => (
                    <Row
                      key={older.id}
                      report={older}
                      reports={state.reports}
                      beneath
                      onOpen={open}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
