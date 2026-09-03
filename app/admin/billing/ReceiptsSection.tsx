import { useEffect, useMemo, useState } from 'react';
import { ReceiptsResponse, type ReceiptRow } from '../../api/billing/document-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { useDocumentActions } from './documents';
import { formatFils } from './money';
import { SendDrawer } from './SendDrawer';

/**
 * The receipt book: money received, newest first.
 *
 * Its own list and its own numbering, because a payment settles a tax invoice
 * and is not one (405_billing_receipt.sql). This is what a coordinator reads
 * down when a family rings to ask what was received against what — the question
 * that had no answer at all before payments had numbers.
 */

const METHOD_LABELS: Record<ReceiptRow['method'], string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  link: 'Payment link',
};

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; response: ReceiptsResponse };

export function ReceiptsSection() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const { open, ensure, busyOn, error, setError } = useDocumentActions();
  const [sending, setSending] = useState<{
    documentId: string;
    clientId: string;
    reference: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/payments')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'ready', response: ReceiptsResponse.parse(await res.json()) });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  async function startSending(row: ReceiptRow) {
    setError(null);
    const document_ = row.documentId ? { id: row.documentId } : await ensure({ paymentId: row.id });
    if (!document_) return;
    setSending({
      documentId: document_.id,
      clientId: row.clientId,
      reference: row.receiptReference ?? '',
    });
  }

  const columns = useMemo<Column<ReceiptRow>[]>(
    () => [
      {
        key: 'reference',
        header: 'Number',
        // A payment recorded before the receipt book existed has no number, and
        // nothing invents one for it.
        render: (row) => row.receiptReference ?? <span className="muted">—</span>,
      },
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
      { key: 'method', header: 'How', render: (row) => METHOD_LABELS[row.method] },
      {
        key: 'settles',
        header: 'Against',
        render: (row) => row.invoiceReference ?? <span className="muted">On account</span>,
      },
      {
        key: 'received',
        header: 'Received',
        numeric: true,
        render: (row) => formatDate(row.receivedOn),
      },
      {
        key: 'amount',
        header: 'Amount (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.amountFils),
      },
      {
        key: 'document',
        header: 'Document',
        render: (row) =>
          row.receiptReference === null ? (
            <span className="small muted">No receipt</span>
          ) : (
            <span className="row-actions">
              <Button
                variant="quiet"
                disabled={busyOn === row.id}
                onClick={() => void open(row.id, { paymentId: row.id })}
              >
                {busyOn === row.id ? 'Opening…' : 'Open PDF'}
              </Button>
              <Button variant="quiet" onClick={() => void startSending(row)}>
                Send
              </Button>
            </span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyOn],
  );

  return (
    <>
      {state.kind === 'loading' ? <Note>Loading the receipts.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The receipts could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {error ? <Note tone="critical">{error}</Note> : null}
          {state.response.truncated ? <Note>The fifty most recent payments are shown.</Note> : null}
          <Table
            caption="Receipts"
            columns={columns}
            rows={state.response.receipts}
            rowKey={(row) => row.id}
            empty="No payment has been recorded yet."
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
