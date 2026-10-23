import { useCallback, useEffect, useMemo, useState } from 'react';
import { isoDateIn } from '@domain/shared';
import { DebtorsResponse, type DebtorRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { Table, type Column } from '../../shell/components/Table';
import { DOWNLOAD_REFUSED, downloadCsv } from '../accounting/download';
import { formatDate } from './BillingPage';
import { formatFils } from './money';
import { roomFor, useWidth } from './useWidth';

/**
 * Who owes the practice, as at a day (docs/superpowers/specs/2026-10-23-
 * debtors-design.md, "Screen"). The server ages every household and adds the
 * totals; nothing here sums, splits or compares money. The totals cover every
 * household with a balance, the rows only the largest fifty, and when there
 * are more the screen says so and points at the CSV, which carries them all.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/** Seven columns need about 760px on a line each; below that, a card each. */
const TABLE_NEEDS = 760;

const BUCKETS = [
  ['b0to30Fils', '0–30'],
  ['b31to60Fils', '31–60'],
  ['b61to90Fils', '61–90'],
  ['over90Fils', 'Over 90'],
] as const;

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; asOf: string; response: DebtorsResponse };

export function DebtorsList({ onOpen }: { onOpen: (row: DebtorRow) => void }) {
  const { apiFetch } = useAuth();
  const [asOf, setAsOf] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [listRef, listWidth] = useWidth<HTMLDivElement>();

  // An empty date (half-typed) asks nothing; the previous list stays up.
  useEffect(() => {
    if (!asOf) {
      return;
    }
    let current = true;
    void apiFetch(`/api/billing/debtors?asOf=${asOf}`)
      .then(async (res) => {
        if (!current) return;
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', asOf, response: DebtorsResponse.parse(await res.json()) });
      })
      .catch(() => {
        if (current) setState({ kind: 'error' });
      });
    return () => {
      current = false;
    };
  }, [apiFetch, asOf]);

  const download = useCallback(async () => {
    setDownloadError(null);
    const arrived = await downloadCsv(apiFetch, `/api/billing/debtors.csv?asOf=${asOf}`);
    if (!arrived) setDownloadError(DOWNLOAD_REFUSED);
  }, [apiFetch, asOf]);

  const columns = useMemo<Column<DebtorRow>[]>(
    () => [
      {
        key: 'client',
        header: 'Client',
        render: (row) => (
          <button type="button" className="debtor__open" onClick={() => onOpen(row)}>
            <span className="name">
              <span>{row.name}</span>
              <span className="small muted">{row.mrn}</span>
            </span>
          </button>
        ),
      },
      {
        key: 'owed',
        header: 'Owed',
        numeric: true,
        align: 'end',
        render: (row) => <Owed row={row} />,
      },
      ...BUCKETS.map(([key, header]): Column<DebtorRow> => ({
        key,
        header,
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row[key]),
      })),
      {
        key: 'oldest',
        header: 'Oldest open',
        numeric: true,
        render: (row) =>
          row.oldestOpenOn ? formatDate(row.oldestOpenOn) : <span className="muted">None</span>,
      },
    ],
    [onOpen],
  );

  const response = state.kind === 'ready' ? state.response : null;

  return (
    <div className="debtors">
      <div className="toolbar debtors__bar">
        <DateField id="debtors-as-at" label="As at" value={asOf} onChange={setAsOf} />
        <Button variant="secondary" onClick={() => void download()}>
          Download CSV
        </Button>
      </div>
      {downloadError ? <Note tone="critical">{downloadError}</Note> : null}
      {state.kind === 'loading' ? <Note>Loading who owes the practice.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The list could not be loaded. Try again.</Note>
      ) : null}

      {response ? (
        <>
          <dl className="figures balance__figures debtors__totals" aria-label="Totals">
            <div className="figures__item figures__item--owed">
              <dt>Owed</dt>
              <dd className="numeric">{formatFils(response.totals.owedFils)}</dd>
            </div>
            {BUCKETS.map(([key, label]) => (
              <div key={key} className="figures__item">
                <dt>{label}</dt>
                <dd className="numeric">{formatFils(response.totals[key])}</dd>
              </div>
            ))}
            <div className="figures__item">
              <dt>In credit</dt>
              <dd className="numeric">{formatFils(response.totals.inCreditFils)}</dd>
            </div>
          </dl>

          <div ref={listRef}>
            {roomFor(listWidth, TABLE_NEEDS) ? (
              <Table
                caption="Households with a balance"
                columns={columns}
                rows={response.rows}
                rowKey={(row) => row.clientId}
                empty="Nobody owes the practice anything."
              />
            ) : response.rows.length === 0 ? (
              <p className="small muted">Nobody owes the practice anything.</p>
            ) : (
              <ul className="service-cards" aria-label="Households with a balance">
                {response.rows.map((row) => (
                  <li key={row.clientId} className="service-card">
                    <button type="button" className="debtor__open" onClick={() => onOpen(row)}>
                      <span className="service-card__top">
                        <span className="name">
                          <span className="service-card__name">{row.name}</span>
                          <span className="small muted">{row.mrn}</span>
                        </span>
                        <span className="service-card__left numeric">
                          <Owed row={row} />
                        </span>
                      </span>
                    </button>
                    <span className="small muted numeric">
                      {BUCKETS.map(([key, label]) => `${label}: ${formatFils(row[key])}`).join(
                        '. ',
                      )}
                      {row.oldestOpenOn ? `. Oldest open ${formatDate(row.oldestOpenOn)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {response.truncated ? (
            <Note>Showing the 50 largest balances. Download the CSV for all.</Note>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** What the household owes, or — when the practice holds money for it — says so in words. */
function Owed({ row }: { row: DebtorRow }) {
  if (row.owedFils > 0) {
    return (
      <>
        {formatFils(row.owedFils)}
        {row.inCreditFils > 0 ? (
          <span className="small muted"> In credit {formatFils(row.inCreditFils)}</span>
        ) : null}
      </>
    );
  }
  return row.inCreditFils > 0 ? (
    <>In credit {formatFils(row.inCreditFils)}</>
  ) : (
    <>{formatFils(0)}</>
  );
}
