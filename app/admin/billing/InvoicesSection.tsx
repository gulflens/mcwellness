import { useEffect, useMemo, useState } from 'react';
import type { MonthlyMoneyResponse } from '../../api/billing/document-schema';
import { InvoicesResponse, type InvoiceRow } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { useDocumentActions } from './documents';
import { MoneyFigures } from './MoneyFigures';
import { formatFils } from './money';
import { SendDrawer } from './SendDrawer';

/**
 * The invoice book, newest first.
 *
 * Numbers run without gaps, which is the whole point of them: an invoice number
 * is allocated from a per-practice counter and given back when a sale falls
 * through (402_billing_document.sql), so what is listed here is what the Federal
 * Tax Authority would expect to see.
 *
 * Above it, three facts about the month and one sentence about VAT. The
 * sentence is there because a column of zeroes is not an explanation: an owner
 * looking at this screen should be able to see that the practice is not
 * registered, rather than wonder whether the VAT is missing.
 */

const KIND_LABELS: Record<InvoiceRow['kind'], string> = {
  session: 'Visit',
  package: 'Package',
  statement: 'Statement',
  call_out_fee: 'Call-out fee',
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; response: InvoicesResponse; figures: MonthlyMoneyResponse | null };

export function InvoicesSection() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const { open, ensure, busyOn, error, setError } = useDocumentActions();
  const [sending, setSending] = useState<{
    documentId: string;
    clientId: string;
    reference: string;
  } | null>(null);
  const [sendingOn, setSendingOn] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([apiFetch('/api/billing/invoices'), apiFetch('/api/billing/summary')])
      .then(async ([invoices, summary]) => {
        if (!live) return;
        if (!invoices.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          response: InvoicesResponse.parse(await invoices.json()),
          // The figures are a courtesy beside the book, not the reason to be
          // here: if they cannot be had, the book still shows.
          figures: summary.ok ? ((await summary.json()) as MonthlyMoneyResponse) : null,
        });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  async function startSending(row: InvoiceRow) {
    setError(null);
    // The same busy state Open PDF has, and for the same reason: on a row whose
    // document has not been made yet this renders it and uploads it, which is
    // not instant, and a button that does nothing visible for a second is a
    // button somebody presses twice.
    setSendingOn(row.id);
    try {
      const document_ = row.documentId
        ? { id: row.documentId }
        : await ensure({ invoiceId: row.id });
      if (!document_) return;
      setSending({ documentId: document_.id, clientId: row.clientId, reference: row.reference });
    } finally {
      setSendingOn(null);
    }
  }

  const registered = state.kind === 'ready' ? state.response.practiceVatRegistered : false;

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
      {
        key: 'kind',
        header: 'For',
        // A forgiven call-out fee stays in the book, with its number and its
        // figures, and stops counting in the balance (migration 408). So the
        // row says so: without it the total owed and the charges listed above
        // it do not add up, and nobody can see why.
        render: (row) =>
          row.waivedAt ? (
            <span className="name">
              <span>{KIND_LABELS[row.kind]}</span>
              <span className="small muted">Waived {formatDate(row.waivedAt)}</span>
            </span>
          ) : (
            KIND_LABELS[row.kind]
          ),
      },
      {
        key: 'issued',
        header: 'Issued',
        numeric: true,
        render: (row) => formatDate(row.issuedOn),
      },
      {
        // What came off the list figures on this invoice's lines; an em dash
        // on the invoices where nothing did.
        key: 'discount',
        header: 'Discount',
        numeric: true,
        align: 'end',
        render: (row) => (row.discountFils > 0 ? formatFils(row.discountFils) : '—'),
      },
      {
        key: 'net',
        header: 'Net (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.netFils),
      },
      // The VAT column is shown only while the practice charges VAT. A column
      // of zeroes invites a reader to look for a rate that is not there.
      ...(registered
        ? [
            {
              key: 'vat',
              header: 'VAT',
              numeric: true,
              align: 'end' as const,
              render: (row: InvoiceRow) => formatFils(row.vatFils),
            },
          ]
        : []),
      {
        key: 'total',
        header: 'Total',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.grossFils),
      },
      {
        key: 'document',
        header: 'Document',
        render: (row) => (
          <span className="row-actions">
            <Button
              variant="quiet"
              disabled={busyOn === row.id}
              onClick={() => void open(row.id, { invoiceId: row.id })}
            >
              {busyOn === row.id ? 'Opening…' : 'Open PDF'}
            </Button>
            <Button
              variant="quiet"
              disabled={sendingOn === row.id}
              onClick={() => void startSending(row)}
            >
              {sendingOn === row.id ? 'Preparing…' : 'Send'}
            </Button>
          </span>
        ),
      },
    ],
    // `open` and `startSending` are stable enough for a row action; the list
    // rebuilds when the registration or a busy row changes, which is what the
    // buttons read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registered, busyOn, sendingOn],
  );

  return (
    <>
      {state.kind === 'loading' ? <Note>Loading the invoices.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The invoices could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {state.figures ? <MoneyFigures figures={state.figures} /> : null}

          {/* One sentence, read from the practice's own record. */}
          <p className="small muted vat-status">
            {state.response.practiceVatRegistered
              ? 'The practice is registered for VAT: invoices carry VAT at the standard rate.'
              : 'The practice is not registered for VAT: invoices carry no VAT.'}
          </p>

          {error ? <Note tone="critical">{error}</Note> : null}
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

      {sending ? (
        <SendDrawer
          documentId={sending.documentId}
          clientId={sending.clientId}
          reference={sending.reference}
          onClose={() => setSending(null)}
        />
      ) : null}
    </>
  );
}
