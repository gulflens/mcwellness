import { useEffect, useState } from 'react';
import { formatFils } from '@domain/shared';
import { BalanceResponse } from '../../api/billing/ledger-schema';
import { ReportListResponse, type ReportRow } from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Note } from '../../shell/components/Controls';
import { formatDate } from '../billing/BillingPage';
import { kindLabel } from '../reports/kinds';

/**
 * The answer a record's overview leads with (DESIGN.md, "The record
 * workspace"; ADR 0004): how far through the programme the client is, what
 * the household owes, and the latest report. The figures are display size
 * because they are the point of the screen.
 *
 * Nothing new is read: the balance comes from the billing route and the
 * reports from the reports list, which check their own capabilities and
 * write their own audit rows. A role either route refuses (finance cannot
 * list reports) simply does not see that block, rather than an error it
 * could do nothing about.
 */

type Load<T> =
  { kind: 'loading' } | { kind: 'hidden' } | { kind: 'error' } | { kind: 'ready'; value: T };

function useRead<T>(url: string, parse: (body: unknown) => T): Load<T> {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void apiFetch(url)
      .then(async (res): Promise<Load<T>> => {
        if (res.status === 403 || res.status === 404) return { kind: 'hidden' };
        if (!res.ok) return { kind: 'error' };
        return { kind: 'ready', value: parse(await res.json()) };
      })
      .catch((): Load<T> => ({ kind: 'error' }))
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
    // `parse` is a module-level schema function; the url names the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, url]);
  return state;
}

/**
 * The newest current issued report. A withdrawn record (kept against the
 * wrong client) is never this client's latest.
 */
export function latestIssued(reports: readonly ReportRow[]): ReportRow | null {
  const replaced = new Set(reports.map((r) => r.supersedesId).filter(Boolean));
  const current = reports
    .filter((r) => r.status === 'issued' && !r.withdrawn && r.issuedOn && !replaced.has(r.id))
    .sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? ''));
  return current[0] ?? null;
}

function Figure({
  label,
  value,
  detail,
  quiet = false,
}: {
  label: string;
  value: string;
  detail?: string;
  /** A state in words rather than a figure: heading size, not display (The Focal Figure Rule). */
  quiet?: boolean;
}) {
  return (
    <div className="record-summary__block">
      <p className="record-summary__label">{label}</p>
      <p
        className={
          quiet
            ? 'record-summary__figure record-summary__figure--quiet'
            : 'record-summary__figure numeric'
        }
      >
        {value}
      </p>
      {detail ? <p className="record-summary__detail small">{detail}</p> : null}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="record-summary__block" aria-hidden="true">
      <p className="record-summary__label">{label}</p>
      <span className="record-summary__placeholder" />
    </div>
  );
}

export function RecordSummary({ clientId }: { clientId: string }) {
  const balance = useRead(`/api/billing/clients/${clientId}/balance`, (body) =>
    BalanceResponse.parse(body),
  );
  const reports = useRead(
    `/api/reports?clientId=${encodeURIComponent(clientId)}`,
    (body) => ReportListResponse.parse(body).reports,
  );

  const loading = balance.kind === 'loading' || reports.kind === 'loading';
  const failed = balance.kind === 'error' || reports.kind === 'error';
  if (balance.kind === 'hidden' && reports.kind === 'hidden') return null;

  return (
    <section className="record-summary" aria-label="Programme summary" aria-busy={loading}>
      {loading ? <span className="visually-hidden">Loading the programme summary.</span> : null}
      <div className="record-summary__grid">
        {balance.kind === 'loading' ? (
          <>
            <Placeholder label="Programme" />
            <Placeholder label="Balance" />
          </>
        ) : balance.kind === 'ready' ? (
          <>
            <ProgrammeFigure balance={balance.value} />
            <BalanceFigure outstandingFils={balance.value.outstandingFils} />
          </>
        ) : null}
        {reports.kind === 'loading' ? (
          <Placeholder label="Latest report" />
        ) : reports.kind === 'ready' ? (
          <ReportFigure report={latestIssued(reports.value)} />
        ) : null}
      </div>
      {failed ? (
        <Note tone="critical">Part of this summary could not be loaded. Reopen the record.</Note>
      ) : null}
    </section>
  );
}

function ProgrammeFigure({ balance }: { balance: BalanceResponse }) {
  const total = balance.delivered + balance.remaining;
  if (total === 0) {
    return (
      <Figure label="Programme" value="Not started" quiet detail="No sessions purchased yet." />
    );
  }
  const remaining =
    balance.remaining === 1 ? '1 session to come.' : `${balance.remaining} sessions to come.`;
  const expiry = balance.nextExpiryOn
    ? ` Next credit runs out on ${formatDate(balance.nextExpiryOn)}.`
    : '';
  return (
    <Figure
      label="Sessions delivered"
      value={`${balance.delivered} of ${total}`}
      detail={`${remaining}${expiry}`}
    />
  );
}

function BalanceFigure({ outstandingFils }: { outstandingFils: number }) {
  if (outstandingFils > 0) {
    return <Figure label="Owed by the household" value={`AED ${formatFils(outstandingFils)}`} />;
  }
  if (outstandingFils < 0) {
    return <Figure label="Household credit" value={`AED ${formatFils(-outstandingFils)}`} />;
  }
  return <Figure label="Balance" value="Nothing owed" quiet />;
}

function ReportFigure({ report }: { report: ReportRow | null }) {
  if (!report || !report.issuedOn) {
    return (
      <Figure label="Latest report" value="None yet" quiet detail="No report has been issued." />
    );
  }
  return (
    <Figure
      label="Latest report"
      value={formatDate(report.issuedOn)}
      detail={
        report.reference ? `${kindLabel(report.kind)}, ${report.reference}` : kindLabel(report.kind)
      }
    />
  );
}
