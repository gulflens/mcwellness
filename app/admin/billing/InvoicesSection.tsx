import { useEffect, useMemo, useState } from 'react';
import { InvoicesResponse, type InvoiceRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { formatFils } from './money';

/**
 * The invoice book, newest first.
 *
 * Numbers run without gaps, which is the whole point of them: an invoice
 * number is allocated from a per-practice counter and given back when a sale
 * falls through (402_billing_document.sql), so what is listed here is what the
 * Federal Tax Authority would expect to see.
 *
 * The rendered PDF is the next pull request's, so there is nothing to
 * download yet and this screen does not pretend otherwise.
 */

const KIND_LABELS: Record<InvoiceRow['kind'], string> = {
  session: 'Visit',
  package: 'Package',
  statement: 'Statement',
};

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; response: InvoicesResponse };

export function InvoicesSection() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/invoices')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', response: InvoicesResponse.parse(await res.json()) });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const columns = useMemo<Column<InvoiceRow>[]>(
    () => [
      { key: 'reference', header: 'Number', render: (row) => row.reference },
      {
        key: 'client',
        header: 'Client',
        render: (row) => (
          <span className="name">
            <span>{row.clientName}</span>
            <span className="small muted">{row.clientMrn}</span>
          </span>
        ),
      },
      { key: 'kind', header: 'For', render: (row) => KIND_LABELS[row.kind] },
      {
        key: 'issued',
        header: 'Issued',
        numeric: true,
        render: (row) => formatDate(row.issuedOn),
      },
      {
        key: 'net',
        header: 'Net (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.netFils),
      },
      {
        key: 'vat',
        header: 'VAT',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.vatFils),
      },
      {
        key: 'total',
        header: 'Total',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.grossFils),
      },
    ],
    [],
  );

  return (
    <>
      {state.kind === 'loading' ? <Note>Loading the invoices.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The invoices could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {state.response.truncated ? <Note>The fifty most recent invoices are shown.</Note> : null}
          <Table
            caption="Invoices"
            columns={columns}
            rows={state.response.invoices}
            rowKey={(row) => row.id}
            empty="No invoice has been issued yet."
          />
        </>
      ) : null}
    </>
  );
}
