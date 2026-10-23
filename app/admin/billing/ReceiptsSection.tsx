import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  PaymentSearchResponse,
  type MonthlyMoneyResponse,
  type ReceiptRow,
} from '../../api/billing/document-schema';
import { hasRole } from '@domain/shared';
import { type ReversePaymentResponse } from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { formatDate } from './BillingPage';
import { useDocumentActions } from './documents';
import { LedgerSearch, dayOf, groupBy, type Choice } from './LedgerSearch';
import { formatFils, formatNetFils } from './money';
import { RecordPaymentFlow } from './RecordPaymentFlow';
import { ReversePaymentDrawer } from './ReversePaymentDrawer';
import { SendDrawer } from './SendDrawer';
import { roomFor, useWidth } from './useWidth';

/**
 * The receipt book: money received, newest first.
 *
 * Its own list and its own numbering, because a payment settles a tax invoice
 * and is not one (405_billing_receipt.sql). This is what a coordinator reads
 * down when a family rings to ask what was received against what — the question
 * that had no answer at all before payments had numbers.
 *
 * **Money in, by day** (operator, 20 October 2026). The month's receipts
 * first, then the book in bands by the day the money came, each payment with
 * how it was paid and what it settled. The search names a client, a record
 * number, a receipt or an invoice, sent in a request's body
 * (`POST /api/billing/payments/search`; no personal data in a URL); fifty at
 * a time. Record a payment is here too, where money received is read.
 *
 * A table with a desk's room, a slimmer one on a tablet, a list on a phone —
 * one drawn, never all three (useWidth.ts).
 */

const METHOD_LABELS: Record<ReceiptRow['method'], string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  link: 'Payment link',
};

const METHOD_CHOICES: Choice<ReceiptRow['method']>[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'link', label: 'Payment link' },
];

const FULL_TABLE_NEEDS = 860;
const SLIM_TABLE_NEEDS = 560;

type Book = { receipts: ReceiptRow[]; nextBefore: string | null };

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; book: Book; more: 'idle' | 'loading' | 'error' };

/** A receipt's calendar date, read at the practice's noon so it keeps its day. */
function dayOfReceipt(row: ReceiptRow, now: Date) {
  return dayOf(`${row.receivedOn}T12:00:00+04:00`, now);
}

export function ReceiptsSection({ canWrite = false }: { canWrite?: boolean }) {
  const { apiFetch, session } = useAuth();
  // Owner, admin and finance: the roles the reversal route and the database
  // function both check (the same gate as InvoicesSection's canCredit).
  const canReverse =
    session.status === 'signed-in' && hasRole(session.actor, 'owner', 'admin', 'finance');
  const [reversing, setReversing] = useState<ReceiptRow | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [figures, setFigures] = useState<MonthlyMoneyResponse | null>(null);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<ReceiptRow['method'] | null>(null);
  const [reloads, setReloads] = useState(0);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { open, ensure, busyOn, error, setError } = useDocumentActions();
  const [sending, setSending] = useState<{
    documentId: string;
    clientId: string;
    reference: string;
  } | null>(null);
  const [sendingOn, setSendingOn] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const asked = useRef(0);

  const ask = useCallback(
    async (before: string | null) => {
      const res = await apiFetch('/api/billing/payments/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(method ? { methods: [method] } : {}),
          ...(before !== null ? { before } : {}),
        }),
      });
      if (!res.ok) throw new Error(`receipts ${res.status}`);
      return PaymentSearchResponse.parse(await res.json());
    },
    [apiFetch, search, method],
  );

  // The first page, again whenever the question changes or a payment has
  // just been recorded. The search waits a moment after the last key.
  useEffect(() => {
    const mine = ++asked.current;
    const timer = setTimeout(
      () => {
        void ask(null)
          .then((answer) => {
            if (mine !== asked.current) return;
            setState({
              kind: 'ready',
              more: 'idle',
              book: { receipts: answer.receipts, nextBefore: answer.nextBefore },
            });
          })
          .catch(() => {
            if (mine === asked.current) setState({ kind: 'error' });
          });
      },
      search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [ask, search, reloads]);

  // The month's receipts, from the same summary the invoice book leads with.
  // A courtesy: if it cannot be had, the book still shows.
  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/summary')
      .then(async (res) => {
        if (live && res.ok) setFigures((await res.json()) as MonthlyMoneyResponse);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [apiFetch, reloads]);

  async function showOlder(book: Book) {
    if (book.nextBefore === null) return;
    const mine = asked.current;
    setState({ kind: 'ready', book, more: 'loading' });
    try {
      const answer = await ask(book.nextBefore);
      if (mine !== asked.current) return;
      setState({
        kind: 'ready',
        more: 'idle',
        book: { receipts: [...book.receipts, ...answer.receipts], nextBefore: answer.nextBefore },
      });
    } catch {
      if (mine === asked.current) setState({ kind: 'ready', book, more: 'error' });
    }
  }

  async function startSending(row: ReceiptRow) {
    setError(null);
    // The same busy state Open PDF has: on a row whose receipt has not been made
    // yet this renders it and uploads it, and a button that does nothing visible
    // for a second is a button somebody presses twice.
    setSendingOn(row.id);
    try {
      const document_ = row.documentId
        ? { id: row.documentId }
        : await ensure({ paymentId: row.id });
      if (!document_) return;
      setSending({
        documentId: document_.id,
        clientId: row.clientId,
        reference: row.receiptReference ?? '',
      });
    } finally {
      setSendingOn(null);
    }
  }

  function reversed(row: ReceiptRow, reversal: ReversePaymentResponse['reversal']) {
    setReversing(null);
    setNote(null);
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            book: {
              ...current.book,
              receipts: current.book.receipts.map((r) =>
                r.id === row.id
                  ? { ...r, reversedOn: reversal.reversedOn, reversalId: reversal.id }
                  : r,
              ),
            },
          }
        : current,
    );
    // The month's figure is net of the reversal; ask for it again.
    void apiFetch('/api/billing/summary')
      .then(async (res) => {
        if (res.ok) setFigures((await res.json()) as MonthlyMoneyResponse);
      })
      .catch(() => undefined);
  }

  const actions: RowActions = {
    reverse: canReverse ? (row) => setReversing(row) : null,
    open: (row) => void open(row.id, { paymentId: row.id }),
    send: (row) => void startSending(row),
    opening: busyOn,
    preparing: sendingOn,
  };
  const filtering = search.trim() !== '' || method !== null;
  const now = new Date();

  return (
    <>
      <div className="receipts__head">
        {figures ? (
          <dl className="figures receipts__month">
            <div className="figures__item">
              <dt>Received this month (AED)</dt>
              <dd className="numeric">{formatNetFils(figures.cashCollectedFils)}</dd>
              <dd className="small muted">What arrived, including any VAT.</dd>
            </div>
          </dl>
        ) : null}
        {canWrite ? (
          <Button
            variant="primary"
            onClick={() => {
              setNote(null);
              setPaying(true);
            }}
          >
            Record a payment
          </Button>
        ) : null}
      </div>

      {note ? (
        <div role="status">
          <Note>{note}</Note>
        </div>
      ) : null}

      <LedgerSearch
        label="Find a receipt"
        placeholder="Client, record number, receipt or invoice"
        search={search}
        onSearch={setSearch}
        groupLabel="How it was paid"
        choices={METHOD_CHOICES}
        chosen={method}
        onChoose={setMethod}
      />

      {state.kind === 'loading' ? <Note>Loading the receipts.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The receipts could not be loaded. Try again.</Note>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}

      {state.kind === 'ready' ? (
        <div ref={ref} className="ledger-book">
          {state.book.receipts.length === 0 ? (
            <p className="small muted ledger-book__empty">
              {filtering ? 'No payment matches.' : 'No payment has been recorded yet.'}
            </p>
          ) : roomFor(width, FULL_TABLE_NEEDS) ? (
            <ReceiptTable book={state.book} actions={actions} now={now} slim={false} />
          ) : roomFor(width, SLIM_TABLE_NEEDS) ? (
            <ReceiptTable book={state.book} actions={actions} now={now} slim />
          ) : (
            <ReceiptList book={state.book} actions={actions} now={now} />
          )}

          {state.book.nextBefore !== null ? (
            <div className="ledger-book__more">
              {state.more === 'error' ? (
                <Note tone="critical">The older payments could not be loaded. Try again.</Note>
              ) : null}
              <Button
                variant="secondary"
                disabled={state.more === 'loading'}
                onClick={() => void showOlder(state.book)}
              >
                {state.more === 'loading' ? 'Loading…' : 'Show older payments'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {paying ? (
        <RecordPaymentFlow
          onClose={() => setPaying(false)}
          onRecorded={(summary) => {
            setPaying(false);
            setNote(summary);
            setReloads((count) => count + 1);
          }}
        />
      ) : null}

      {reversing ? (
        <ReversePaymentDrawer
          payment={reversing}
          onClose={() => setReversing(null)}
          onReversed={(reversal) => reversed(reversing, reversal)}
        />
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

type RowActions = {
  /** Null when the reader may not reverse a payment. */
  reverse: ((row: ReceiptRow) => void) | null;
  open: (row: ReceiptRow) => void;
  send: (row: ReceiptRow) => void;
  opening: string | null;
  preparing: string | null;
};

function DocumentButtons({ row, actions }: { row: ReceiptRow; actions: RowActions }) {
  // A payment recorded before the receipt book existed has no number, and
  // nothing invents one for it, so there is no document to open or send.
  const reverse = <ReverseButton row={row} actions={actions} />;
  if (row.receiptReference === null) {
    return (
      <span className="row-actions">
        <span className="small muted">No receipt</span>
        {reverse}
      </span>
    );
  }
  return (
    <span className="row-actions">
      <Button
        variant="quiet"
        disabled={actions.opening === row.id}
        onClick={() => actions.open(row)}
      >
        {actions.opening === row.id ? 'Opening…' : 'Open PDF'}
      </Button>
      <Button
        variant="quiet"
        disabled={actions.preparing === row.id}
        onClick={() => actions.send(row)}
      >
        {actions.preparing === row.id ? 'Preparing…' : 'Send'}
      </Button>
      {reverse}
    </span>
  );
}

/** "Reverse payment", for those who may, on a payment that still stands. */
function ReverseButton({ row, actions }: { row: ReceiptRow; actions: RowActions }) {
  if (!actions.reverse || row.reversedOn !== null) return null;
  const reverse = actions.reverse;
  return (
    <Button variant="quiet" onClick={() => reverse(row)}>
      Reverse payment
    </Button>
  );
}

/** What a reversed payment says under its figures, dated like the rest. */
function ReversedNote({ row }: { row: ReceiptRow }) {
  return row.reversedOn ? (
    <span className="small muted">Reversed {formatDate(row.reversedOn)}</span>
  ) : null;
}

/** "Against INV-000044", or "On account" when it named no invoice. */
function Against({ row }: { row: ReceiptRow }) {
  return row.invoiceReference ? (
    <>{row.invoiceReference}</>
  ) : (
    <span className="muted">On account</span>
  );
}

/** How it was paid, as a mark beside the words. Neutral: hue is reserved. */
function MethodMark({ method }: { method: ReceiptRow['method'] }) {
  return (
    <span className="method-mark" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        {method === 'cash' ? (
          <>
            <rect x="2" y="5" width="16" height="10" rx="1.5" />
            <circle cx="10" cy="10" r="2.2" />
          </>
        ) : method === 'transfer' ? (
          <path d="M3 8l7-4 7 4M4 8v7M8 8v7M12 8v7M16 8v7M3 16h14" />
        ) : (
          <path d="M8.5 11.5l3-3M7 9.5l-2 2a2.5 2.5 0 003.5 3.5l2-2M13 10.5l2-2A2.5 2.5 0 0011.5 5l-2 2" />
        )}
      </svg>
    </span>
  );
}

function ReceiptTable({
  book,
  actions,
  now,
  slim,
}: {
  book: Book;
  actions: RowActions;
  now: Date;
  slim: boolean;
}) {
  const days = groupBy(book.receipts, (row) => dayOfReceipt(row, now));
  const columns = slim ? 4 : 7;
  return (
    <div className="ledger__scroll">
      <table className="ledger ledger--pinned">
        <caption className="visually-hidden">Receipts</caption>
        <thead>
          {slim ? (
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Receipt</th>
              <th scope="col" className="numeric align-end">
                Amount (AED)
              </th>
              <th scope="col">Document</th>
            </tr>
          ) : (
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Client</th>
              <th scope="col">How</th>
              <th scope="col">Against</th>
              <th scope="col" className="numeric">
                Received
              </th>
              <th scope="col" className="numeric align-end">
                Amount (AED)
              </th>
              <th scope="col">Document</th>
            </tr>
          )}
        </thead>
        <tbody>
          {days.map(({ key, label, items }) => (
            <Fragment key={key}>
              <tr className="ledger__band">
                <th scope="colgroup" colSpan={columns}>
                  {label}
                </th>
              </tr>
              {items.map((row) =>
                slim ? (
                  <tr key={row.id}>
                    <td>
                      <span className="method-cell">
                        <MethodMark method={row.method} />
                        <span className="name">
                          <span>{row.clientName}</span>
                          <span className="small muted">{METHOD_LABELS[row.method]}</span>
                          <ReversedNote row={row} />
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="name">
                        <span>{row.receiptReference ?? 'No receipt'}</span>
                        <span className="small muted">
                          <Against row={row} />
                        </span>
                      </span>
                    </td>
                    <td className="numeric align-end">
                      <strong className="price-total">{formatFils(row.amountFils)}</strong>
                    </td>
                    <td>
                      <DocumentButtons row={row} actions={actions} />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td>{row.receiptReference ?? <span className="muted">—</span>}</td>
                    <td>
                      <span className="name">
                        <span>{row.clientName}</span>
                        <span className="small muted">{row.clientMrn}</span>
                      </span>
                    </td>
                    <td>
                      <span className="method-cell">
                        <MethodMark method={row.method} />
                        {METHOD_LABELS[row.method]}
                      </span>
                    </td>
                    <td>
                      <Against row={row} />
                    </td>
                    <td className="numeric">
                      <span className="name">
                        <span>{formatDate(row.receivedOn)}</span>
                        <ReversedNote row={row} />
                      </span>
                    </td>
                    <td className="numeric align-end">
                      <strong className="price-total">{formatFils(row.amountFils)}</strong>
                    </td>
                    <td>
                      <DocumentButtons row={row} actions={actions} />
                    </td>
                  </tr>
                ),
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A phone's book, a day at a time; a tap shows a receipt's two actions. */
function ReceiptList({ book, actions, now }: { book: Book; actions: RowActions; now: Date }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const days = groupBy(book.receipts, (row) => dayOfReceipt(row, now));
  return (
    <div className="ledger-list">
      {days.map(({ key, label, items }) => (
        <section key={key} aria-label={`Receipts, ${label}`}>
          <h3 className="ledger-list__band">{label}</h3>
          <ul className="ledger-list__items">
            {items.map((row) => {
              const expanded = openId === row.id;
              return (
                <li key={row.id} className="ledger-list__item">
                  <button
                    type="button"
                    className="ledger-list__row"
                    aria-expanded={expanded}
                    aria-controls={`receipt-${row.id}`}
                    onClick={() => setOpenId(expanded ? null : row.id)}
                  >
                    <MethodMark method={row.method} />
                    <span className="name ledger-list__who">
                      <span>{row.clientName}</span>
                      <span className="small muted">
                        {row.receiptReference ?? 'No receipt'}, {METHOD_LABELS[row.method]},{' '}
                        <Against row={row} />
                      </span>
                      <ReversedNote row={row} />
                    </span>
                    <span className="ledger-list__amount numeric">
                      {formatFils(row.amountFils)}
                    </span>
                  </button>
                  {expanded ? (
                    <div id={`receipt-${row.id}`} className="ledger-list__actions">
                      <DocumentButtons row={row} actions={actions} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
