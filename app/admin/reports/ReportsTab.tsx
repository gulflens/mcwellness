import { Fragment, useState } from 'react';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../shell/components/StatusChip';
import type { ReportRow } from '../../api/reports/schema';
import { ReportEditor } from './ReportEditor';
import { ReportView } from './ReportView';
import { canDeliverReports, canDraftReports, canSupersedeReports } from './reportsAccess';
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
 * nothing else. Signing, superseding and sending all live inside those two,
 * beside the thing they act on.
 *
 * **A draft opens in the editor, not the viewer.** Every row used to open in
 * `ReportView`, which offers a draft no edit, no preview and no signature — so
 * a saved draft, and every correction started by "Correct this report", could
 * be finished only through the API. A draft row lands in the editor loaded
 * with what was saved, and a supersede hands its corrected draft straight
 * there, which is what section 4.3 describes.
 */

const KIND_WORDS: Record<string, string> = {
  session: 'Session',
  progress: 'Progress',
};

const STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued',
  superseded: 'Replaced',
};

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  issued: 'ok',
  superseded: 'neutral',
};

function coverageOf(report: ReportRow): string {
  if (report.coverageFrom && report.coverageTo) {
    return `${report.coverageFrom} to ${report.coverageTo}`;
  }
  return report.issuedOn ?? '';
}

function Row({
  report,
  beneath = false,
  onOpen,
}: {
  report: ReportRow;
  beneath?: boolean;
  onOpen: (report: ReportRow) => void;
}) {
  return (
    <tr className={beneath ? 'reports__row--superseded' : undefined}>
      <td>
        <button type="button" className="link" onClick={() => onOpen(report)}>
          {report.reference ?? 'Not yet signed'}
        </button>
        {beneath && report.amendmentReason ? (
          <span className="reports__reason small">Replaced: {report.amendmentReason}</span>
        ) : null}
      </td>
      <td>{KIND_WORDS[report.kind] ?? report.kind}</td>
      <td className="numeric">{coverageOf(report)}</td>
      <td>
        <StatusChip
          label={STATUS_WORDS[report.status] ?? report.status}
          tone={STATUS_TONE[report.status] ?? 'neutral'}
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

  const mayWrite = canDraftReports(actor, now, clientId) && !erased;
  const maySupersede = canSupersedeReports(actor, now, clientId) && !erased;
  const maySend = canDeliverReports(actor, now) && !erased;

  if (state.kind === 'loading') return <Note>Loading.</Note>;
  if (state.kind === 'error') return <Note tone="critical">The reports could not be loaded.</Note>;

  function closeEditor(): void {
    setWriting(null);
    setDraftId(null);
    void refetch();
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
        maySupersede={maySupersede}
        maySend={maySend}
        onBack={() => {
          setOpenId(null);
          void refetch();
        }}
        onSuperseded={(id, superseded) => {
          // Straight into the editor on the corrected draft: a correction the
          // practitioner cannot then read over and sign is a correction that
          // only the API can finish.
          setOpenId(null);
          setDraftId(id);
          setWriting(superseded);
        }}
      />
    );
  }

  /** A draft is edited; anything signed is read. */
  function open(report: ReportRow): void {
    if (report.status === 'draft' && mayWrite) {
      setDraftId(report.id);
      setWriting(report.kind);
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
        </div>
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
                  <Row report={head} onOpen={open} />
                  {superseded.map((older) => (
                    <Row key={older.id} report={older} beneath onOpen={open} />
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
