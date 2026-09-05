import { useCallback, useState } from 'react';
import {
  DocumentLinkResponse,
  MoneyResponse,
  type PortalClient,
  type PortalInvoice,
  type PortalPayment,
} from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Note } from '../shell/components/Controls';
import { Sections } from './Layout';
import { PHRASES, useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * `/portal/money` — what is owed, what is left, and the papers
 * (docs/SPEC/client-portal.md section 3.3).
 *
 * **A young person's own login never sees this screen.** The router sends them
 * home; if they arrive anyway the route answers 403 and the screen says so in a
 * sentence, because an empty money screen would read as "your household owes
 * nothing" rather than "this is not shown to you".
 *
 * **A document opens through a short-lived signed link, fetched when the button
 * is pressed and never rendered into the page in advance.** That is the same
 * discipline the admin console's own document links keep: a link that sits in
 * the markup is a link that ends up in a screenshot, a bookmark or a log.
 *
 * Figures are tabular and the currency is named once, by the section, never
 * repeated on every row.
 */

function DocumentButton({ documentId }: { documentId: string }) {
  const words = useWords();
  const { apiFetch } = useAuth();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const open = useCallback(() => {
    setState('busy');
    void apiFetch(`/api/portal/documents/${documentId}/link`)
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

function InvoiceRow({ invoice }: { invoice: PortalInvoice }) {
  const words = useWords();
  return (
    <div className="portal__row">
      <span className="numeric">{invoice.reference}</span>
      <span className="numeric">{words.date(invoice.issuedOn)}</span>
      <span className="numeric">{words.money(invoice.grossFils)}</span>
      {invoice.documentId ? <DocumentButton documentId={invoice.documentId} /> : null}
    </div>
  );
}

function PaymentRow({ payment }: { payment: PortalPayment }) {
  const words = useWords();
  return (
    <div className="portal__row">
      <span className="numeric">{words.date(payment.receivedOn)}</span>
      <span>{words.paymentMethod(payment.method)}</span>
      <span className="numeric">{words.money(payment.amountFils)}</span>
      {payment.receiptReference ? (
        <span className="numeric small muted">{payment.receiptReference}</span>
      ) : null}
      {payment.documentId ? <DocumentButton documentId={payment.documentId} /> : null}
    </div>
  );
}

export function MoneyScreen() {
  const words = useWords();
  const money = usePortalRead('/api/portal/money', MoneyResponse);

  if (money.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (money.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (money.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const { clients, balances, packages, invoices, payments } = money.data;
  const shown: PortalClient[] = clients.filter((client) => client.moneyVisible);

  return (
    <>
      <section className="portal__section">
        <h1>{words.t('balance')}</h1>
        <p className="small muted">{words.t('amountsInAed')}</p>
        <Sections
          clients={shown}
          render={(client) => {
            const balance = balances.find((row) => row.clientId === client.id);
            if (!balance) return null;
            const owed = balance.outstandingFils;
            const label =
              owed > 0 ? words.t('owed') : owed < 0 ? words.t('inCredit') : words.t('settled');
            return (
              <dl className="portal__facts">
                <dt>{label}</dt>
                <dd className="numeric portal__figure">
                  {owed === 0 ? '' : words.money(Math.abs(owed))}
                </dd>
              </dl>
            );
          }}
        />
      </section>

      <section className="portal__section">
        <h2>{words.t('packages')}</h2>
        {packages.length === 0 ? (
          <Note>{words.t('noPackages')}</Note>
        ) : (
          <Sections
            clients={shown}
            render={(client) => {
              const mine = packages.filter((row) => row.clientId === client.id);
              return mine.length === 0 ? null : (
                <div className="portal__list">
                  {mine.map((row) => (
                    <div key={row.id} className="portal__row">
                      <span>{words.locale === 'ar' && row.nameAr ? row.nameAr : row.name}</span>
                      <span className="numeric">
                        {words.phrase(PHRASES.sessionOf(row.used, row.total))}
                      </span>
                      <span className="small muted">
                        {words.t('expires')}{' '}
                        <span className="numeric">{words.date(row.expiresOn)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
        )}
      </section>

      <section className="portal__section">
        <h2>{words.t('invoices')}</h2>
        {invoices.length === 0 ? (
          <Note>{words.t('noInvoices')}</Note>
        ) : (
          <Sections
            clients={shown}
            render={(client) => {
              const mine = invoices.filter((row) => row.clientId === client.id);
              return mine.length === 0 ? null : (
                <div className="portal__list">
                  {mine.map((invoice) => (
                    <InvoiceRow key={invoice.id} invoice={invoice} />
                  ))}
                </div>
              );
            }}
          />
        )}
      </section>

      <section className="portal__section">
        <h2>{words.t('payments')}</h2>
        {payments.length === 0 ? (
          <Note>{words.t('noPayments')}</Note>
        ) : (
          <Sections
            clients={shown}
            render={(client) => {
              const mine = payments.filter((row) => row.clientId === client.id);
              return mine.length === 0 ? null : (
                <div className="portal__list">
                  {mine.map((payment) => (
                    <PaymentRow key={payment.id} payment={payment} />
                  ))}
                </div>
              );
            }}
          />
        )}
      </section>
    </>
  );
}
