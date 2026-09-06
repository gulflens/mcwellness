import { useCallback, useState } from 'react';
import { PortalReportsResponse, type PortalReport } from '../api/portal/schema';
import { DocumentLinkResponse } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { Sections } from './Layout';
import { PHRASES, useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * `/portal/reports` — the reports the practice has written for this household
 * (docs/SPEC/reports-v1.md section 7.3).
 *
 * **Issued reports for their own client, and nothing else**: never a draft,
 * never a superseded version they were not sent, never another household's,
 * never the raw figures except as the report itself quotes them. None of that
 * is decided here — the row policies refuse the rows and the route asks only
 * for this household's — which is why this screen is as plain as it is.
 *
 * **The body never travels.** The reference, the kind, what it covers and when
 * it was issued; the report itself opens through a short-lived signed link
 * fetched when the button is pressed, exactly as the money screen opens an
 * invoice. A link rendered into the page in advance is a link that ends up in
 * a screenshot, a bookmark or a log.
 *
 * Every string is in `app/client/i18n/`; a hardcoded sentence fails review.
 */

function ReportButton({ documentId }: { documentId: string }) {
  const words = useWords();
  const { apiFetch } = useAuth();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const open = useCallback(() => {
    setState('busy');
    void apiFetch(`/api/portal/reports/${documentId}/link`)
      .then(async (res) => {
        if (!res.ok) {
          setState('failed');
          return;
        }
        const { url } = DocumentLinkResponse.parse(await res.json());
        // A blocked popup is null and silent; the state says so rather than
        // leaving a button that appears to do nothing.
        if (window.open(url, '_blank', 'noopener,noreferrer') === null) setState('failed');
        else setState('idle');
      })
      .catch(() => setState('failed'));
  }, [apiFetch, documentId]);

  return (
    <>
      <button
        type="button"
        className="button button--quiet"
        onClick={open}
        disabled={state === 'busy'}
      >
        {words.t('open')}
      </button>
      {state === 'failed' ? (
        <span className="portal__row-note small">{words.t('linkFailed')}</span>
      ) : null}
    </>
  );
}

function ReportRow({ report }: { report: PortalReport }) {
  const words = useWords();
  const covers =
    report.coverageFrom && report.coverageTo
      ? words.phrase(
          PHRASES.coversFromTo(words.date(report.coverageFrom), words.date(report.coverageTo)),
        )
      : '';

  return (
    <div className="portal__row">
      <span className="numeric">{report.reference ?? ''}</span>
      <span>{words.t(report.kind === 'progress' ? 'progressReport' : 'sessionReport')}</span>
      <span className="numeric">{covers}</span>
      <span className="numeric">{report.issuedOn ? words.date(report.issuedOn) : ''}</span>
      {report.status === 'superseded' ? (
        <span className="small muted">{words.t('reportReplaced')}</span>
      ) : null}
      {report.documentId ? <ReportButton documentId={report.documentId} /> : null}
    </div>
  );
}

export function ReportsScreen() {
  const words = useWords();
  const reports = usePortalRead('/api/portal/reports', PortalReportsResponse);

  if (reports.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (reports.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (reports.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const { clients, reports: rows } = reports.data;

  return (
    <section className="portal__section">
      <h1>{words.t('reports')}</h1>
      <p className="small muted">{words.t('reportsBody')}</p>
      {rows.length === 0 ? (
        <Note>{words.t('noReports')}</Note>
      ) : (
        <Sections
          clients={clients}
          render={(client) => {
            const mine = rows.filter((report) => report.clientId === client.id);
            return mine.length === 0 ? null : (
              <div className="portal__list">
                {mine.map((report) => (
                  <ReportRow key={report.id} report={report} />
                ))}
              </div>
            );
          }}
        />
      )}
    </section>
  );
}
