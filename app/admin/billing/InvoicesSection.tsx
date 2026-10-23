import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { hasRole } from '@domain/shared';
import type { MonthlyMoneyResponse } from '../../api/billing/document-schema';
import {
  InvoiceSearchResponse,
  type InvoiceRow,
  type IssueCreditNoteResponse,
} from '../../api/billing/ledger-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { formatDate } from './BillingPage';
import { CreditNoteDrawer } from './CreditNoteDrawer';
import { useDocumentActions } from './documents';
import { LedgerSearch, groupBy, monthOf, type Choice } from './LedgerSearch';
import { MoneyFigures } from './MoneyFigures';
import { formatFils } from './money';
import { SendDrawer } from './SendDrawer';
import { roomFor, useWidth } from './useWidth';

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
 *
 * **Finding one, and the rest of the book** (operator, 20 October 2026). The
 * search names a client, a record number or an invoice number, and goes in a
 * request's body rather than the address (`POST /api/billing/invoices/search`,
 * .claude/rules/ui.md: no personal data in a URL). Fifty at a time, grouped by
 * month; "Show older invoices" asks for the fifty before the last one shown.
 *
 * **Three shapes, one book.** With a desk's room it is the full ledger; on a
 * tablet a slimmer table, the number over its date and the client over what
 * it was for; on a phone a list, a tap on an invoice showing its two actions.
 * One is drawn, never all three (useWidth.ts).
 */

const KIND_LABELS: Record<InvoiceRow['kind'], string> = {
  session: 'Visit',
  package: 'Package',
  statement: 'Statement',
  call_out_fee: 'Call-out fee',
  // A session sold ahead of its visit (migration 411, trunk round 43):
  // 'Visit' above is the same service invoiced after it closed, so this
  // needs its own word rather than sharing that one.
  single_session: 'Session, sold ahead',
};

/** The filter's words, plural, because each names a set of invoices. */
const KIND_CHOICES: Choice<InvoiceRow['kind']>[] = [
  { value: 'session', label: 'Visits' },
  { value: 'package', label: 'Packages' },
  { value: 'single_session', label: 'Sold ahead' },
  { value: 'call_out_fee', label: 'Call-out fees' },
  { value: 'statement', label: 'Statements' },
];

/** Room for every column on a line of its own, and for the slimmer table. */
const FULL_TABLE_NEEDS = 900;
const SLIM_TABLE_NEEDS = 560;

type Book = {
  invoices: InvoiceRow[];
  registered: boolean;
  nextBefore: number | null;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; book: Book; more: 'idle' | 'loading' | 'error' };

export function InvoicesSection() {
  const { apiFetch, session } = useAuth();
  // Owner, admin and finance, the three roles the route and the database
  // function both check (app/api/billing/access.ts, migration 417).
  const canCredit =
    session.status === 'signed-in' && hasRole(session.actor, 'owner', 'admin', 'finance');
  const [crediting, setCrediting] = useState<InvoiceRow | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [figures, setFigures] = useState<MonthlyMoneyResponse | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<InvoiceRow['kind'] | null>(null);
  const { open, ensure, busyOn, error, setError } = useDocumentActions();
  const [sending, setSending] = useState<{
    documentId: string;
    clientId: string;
    reference: string;
  } | null>(null);
  const [sendingOn, setSendingOn] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  // Only the newest question's answer is shown: a reply to a search the
  // reader has already typed past is dropped when it arrives.
  const asked = useRef(0);

  const ask = useCallback(
    async (before: number | null) => {
      const res = await apiFetch('/api/billing/invoices/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(kind ? { kinds: [kind] } : {}),
          ...(before !== null ? { before } : {}),
        }),
      });
      if (!res.ok) throw new Error(`invoices ${res.status}`);
      return InvoiceSearchResponse.parse(await res.json());
    },
    [apiFetch, search, kind],
  );

  // The first page, again whenever the question changes. The search waits a
  // moment after the last key, so a name typed is one request, not six.
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
              book: {
                invoices: answer.invoices,
                registered: answer.practiceVatRegistered,
                nextBefore: answer.nextBefore,
              },
            });
          })
          .catch(() => {
            if (mine === asked.current) setState({ kind: 'error' });
          });
      },
      search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [ask, search]);

  // The figures are a courtesy beside the book, not the reason to be here: if
  // they cannot be had, the book still shows. Asked once, not per search.
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
  }, [apiFetch]);

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
        book: {
          invoices: [...book.invoices, ...answer.invoices],
          registered: answer.practiceVatRegistered,
          nextBefore: answer.nextBefore,
        },
      });
    } catch {
      if (mine === asked.current) setState({ kind: 'ready', book, more: 'error' });
    }
  }

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

  function credited(row: InvoiceRow, note: IssueCreditNoteResponse['creditNote']) {
    setCrediting(null);
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            book: {
              ...current.book,
              invoices: current.book.invoices.map((r) =>
                r.id === row.id
                  ? { ...r, creditNoteReference: note.reference, creditNoteId: note.id }
                  : r,
              ),
            },
          }
        : current,
    );
  }

  const actions: RowActions = {
    open: (row) => void open(row.id, { invoiceId: row.id }),
    openCreditNote: (row) =>
      row.creditNoteId ? void open(`cn-${row.id}`, { creditNoteId: row.creditNoteId }) : undefined,
    credit: canCredit ? (row) => setCrediting(row) : null,
    send: (row) => void startSending(row),
    opening: busyOn,
    preparing: sendingOn,
  };

  const filtering = search.trim() !== '' || kind !== null;

  return (
    <>
      {figures ? <MoneyFigures figures={figures} /> : null}
      {state.kind === 'ready' ? (
        // One sentence, read from the practice's own record.
        <p className="small muted vat-status">
          {state.book.registered
            ? 'The practice is registered for VAT: invoices carry VAT at the standard rate.'
            : 'The practice is not registered for VAT: invoices carry no VAT.'}
        </p>
      ) : null}

      <LedgerSearch
        label="Find an invoice"
        placeholder="Client, record number or invoice number"
        search={search}
        onSearch={setSearch}
        groupLabel="What it was for"
        choices={KIND_CHOICES}
        chosen={kind}
        onChoose={setKind}
      />

      {state.kind === 'loading' ? <Note>Loading the invoices.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The invoices could not be loaded. Try again.</Note>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}

      {state.kind === 'ready' ? (
        <div ref={ref} className="ledger-book">
          {state.book.invoices.length === 0 ? (
            <p className="small muted ledger-book__empty">
              {filtering ? 'No invoice matches.' : 'No invoice has been issued yet.'}
            </p>
          ) : roomFor(width, FULL_TABLE_NEEDS) ? (
            <FullTable book={state.book} actions={actions} />
          ) : roomFor(width, SLIM_TABLE_NEEDS) ? (
            <SlimTable book={state.book} actions={actions} />
          ) : (
            <InvoiceList book={state.book} actions={actions} />
          )}

          {state.book.nextBefore !== null ? (
            <div className="ledger-book__more">
              {state.more === 'error' ? (
                <Note tone="critical">The older invoices could not be loaded. Try again.</Note>
              ) : null}
              <Button
                variant="secondary"
                disabled={state.more === 'loading'}
                onClick={() => void showOlder(state.book)}
              >
                {state.more === 'loading' ? 'Loading…' : 'Show older invoices'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {crediting ? (
        <CreditNoteDrawer
          invoice={crediting}
          onClose={() => setCrediting(null)}
          onIssued={(note) => credited(crediting, note)}
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
  open: (row: InvoiceRow) => void;
  send: (row: InvoiceRow) => void;
  openCreditNote: (row: InvoiceRow) => void;
  /** Null when the reader may not issue credit notes. */
  credit: ((row: InvoiceRow) => void) | null;
  opening: string | null;
  preparing: string | null;
};

/** What an invoice was for, and the day a forgiven fee was forgiven. */
function KindWords({ row }: { row: InvoiceRow }) {
  // A forgiven call-out fee stays in the book, with its number and its
  // figures, and stops counting in the balance (migration 408). So the row
  // says so: without it the total owed and the charges listed above it do not
  // add up, and nobody can see why.
  const note = row.waivedAt
    ? `Waived ${formatDate(row.waivedAt)}`
    : row.creditNoteReference
      ? `Credited ${row.creditNoteReference}`
      : null;
  return note ? (
    <span className="name">
      <span>{KIND_LABELS[row.kind]}</span>
      <span className="small muted">{note}</span>
    </span>
  ) : (
    <>{KIND_LABELS[row.kind]}</>
  );
}

function DocumentButtons({ row, actions }: { row: InvoiceRow; actions: RowActions }) {
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
      {row.creditNoteId ? (
        <Button
          variant="quiet"
          disabled={actions.opening === `cn-${row.id}`}
          onClick={() => actions.openCreditNote(row)}
        >
          {actions.opening === `cn-${row.id}` ? 'Opening…' : 'Open credit note PDF'}
        </Button>
      ) : actions.credit && row.kind !== 'statement' && !row.waivedAt ? (
        <Button variant="quiet" onClick={() => actions.credit?.(row)}>
          Issue credit note
        </Button>
      ) : null}
    </span>
  );
}

/**
 * The full ledger. Net and Total are the same figure while the practice is
 * not registered for VAT, so then the money is one column, "Amount (AED)":
 * two columns that always agree are a sum a reader checks for nothing.
 */
function FullTable({ book, actions }: { book: Book; actions: RowActions }) {
  const months = groupBy(book.invoices, (row) => monthOf(row.issuedOn));
  const columns = book.registered ? 9 : 7;
  return (
    <div className="ledger__scroll">
      <table className="ledger ledger--pinned">
        <caption className="visually-hidden">Invoices</caption>
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Client</th>
            <th scope="col">For</th>
            <th scope="col" className="numeric">
              Issued
            </th>
            <th scope="col" className="numeric align-end">
              Discount
            </th>
            {book.registered ? (
              <>
                <th scope="col" className="numeric align-end">
                  Net (AED)
                </th>
                <th scope="col" className="numeric align-end">
                  VAT
                </th>
                <th scope="col" className="numeric align-end">
                  Total
                </th>
              </>
            ) : (
              <th scope="col" className="numeric align-end">
                Amount (AED)
              </th>
            )}
            <th scope="col">Document</th>
          </tr>
        </thead>
        <tbody>
          {months.map(({ key, label, items }) => (
            <Fragment key={key}>
              <tr className="ledger__band">
                <th scope="colgroup" colSpan={columns}>
                  {label}
                </th>
              </tr>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{row.reference}</td>
                  <td>
                    <span className="name">
                      <span>{row.clientName}</span>
                      <span className="small muted">{row.clientMrn}</span>
                    </span>
                  </td>
                  <td>
                    <KindWords row={row} />
                  </td>
                  <td className="numeric">{formatDate(row.issuedOn)}</td>
                  <td className="numeric align-end">
                    {/* What came off the list figures on this invoice's lines;
                        an em dash on the invoices where nothing did. */}
                    {row.discountFils > 0 ? formatFils(row.discountFils) : '—'}
                  </td>
                  {book.registered ? (
                    <>
                      <td className="numeric align-end">{formatFils(row.netFils)}</td>
                      <td className="numeric align-end">{formatFils(row.vatFils)}</td>
                      <td className="numeric align-end">
                        <strong className="price-total">{formatFils(row.grossFils)}</strong>
                      </td>
                    </>
                  ) : (
                    <td className="numeric align-end">
                      <strong className="price-total">{formatFils(row.grossFils)}</strong>
                    </td>
                  )}
                  <td>
                    <DocumentButtons row={row} actions={actions} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A tablet's table: the number over its date, the client over what it was for. */
function SlimTable({ book, actions }: { book: Book; actions: RowActions }) {
  const months = groupBy(book.invoices, (row) => monthOf(row.issuedOn));
  return (
    <div className="ledger__scroll">
      <table className="ledger ledger--pinned">
        <caption className="visually-hidden">Invoices</caption>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Client</th>
            <th scope="col" className="numeric align-end">
              {book.registered ? 'Total (AED)' : 'Amount (AED)'}
            </th>
            <th scope="col">Document</th>
          </tr>
        </thead>
        <tbody>
          {months.map(({ key, label, items }) => (
            <Fragment key={key}>
              <tr className="ledger__band">
                <th scope="colgroup" colSpan={4}>
                  {label}
                </th>
              </tr>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="name">
                      <span>{row.reference}</span>
                      <span className="small muted">{formatDate(row.issuedOn)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="name">
                      <span>{row.clientName}</span>
                      <span className="small muted">
                        <KindWords row={row} />
                        {row.discountFils > 0 ? `, ${formatFils(row.discountFils)} off` : ''}
                      </span>
                    </span>
                  </td>
                  <td className="numeric align-end">
                    <strong className="price-total">{formatFils(row.grossFils)}</strong>
                  </td>
                  <td>
                    <DocumentButtons row={row} actions={actions} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A phone's list, a month at a time. Tapping an invoice shows its two
 * actions beneath it, so a thumb that only meant to scroll opens nothing.
 */
function InvoiceList({ book, actions }: { book: Book; actions: RowActions }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const months = groupBy(book.invoices, (row) => monthOf(row.issuedOn));
  return (
    <div className="ledger-list">
      {months.map(({ key, label, items }) => (
        <section key={key} aria-label={`Invoices, ${label}`}>
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
                    aria-controls={`invoice-${row.id}`}
                    onClick={() => setOpenId(expanded ? null : row.id)}
                  >
                    <span className="name ledger-list__who">
                      <span>{row.clientName}</span>
                      <span className="small muted">
                        {row.reference}, <KindWords row={row} />
                      </span>
                    </span>
                    <span className="name ledger-list__amount">
                      <span className="numeric">{formatFils(row.grossFils)}</span>
                      <span className="small muted">{formatDate(row.issuedOn)}</span>
                    </span>
                  </button>
                  {expanded ? (
                    <div id={`invoice-${row.id}`} className="ledger-list__actions">
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
