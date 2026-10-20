import { useCallback, useEffect, useMemo, useState } from 'react';
import { BalanceResponse, type ServiceBalanceRow } from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { BillingNote } from './BillingNote';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { ClientPicker } from './ClientPicker';
import { formatDiscount, formatFils } from './money';
import { PaymentDrawer } from './PaymentDrawer';
import { roomFor, useWidth } from './useWidth';

/**
 * What one family has left, and what it owes.
 *
 * Every figure here is derived on the server from the entitlement ledger and
 * the charges and payments against it — nothing on this screen is a stored
 * balance, and nothing on this screen does arithmetic (docs/SPEC/billing.md
 * section 1).
 *
 * The expiry warning is a sentence, not a colour: at sixty days and again at
 * thirty the practice is told in words how long a family has left, because a
 * family who loses prepaid sessions to a date nobody mentioned is a
 * complaint, not an accounting event.
 *
 * **A credit may have no expiry at all**, which is what the practice's own
 * catalogue now carries (the operator's ruling of 12 September 2026,
 * docs/superpowers/plans/2026-09-12-optional-terms.md). Wherever a date would
 * be, the screen says so in words rather than leaving a cell blank: an em dash
 * in an expiry column reads as a figure that failed to load.
 */

/** What a credit with no term says, wherever a date would otherwise be. */
const NO_EXPIRY = 'No expiry';

/**
 * What to say about an expiry, and how loudly.
 *
 * Rendered in the default tone these read like "Loading the balance" — the
 * same grey, the same weight, on a screen where every other line is a state
 * nobody has to act on. Sixty and thirty days want noticing without being
 * wrong yet; a programme that has already run out is wrong now.
 */
const WARNINGS: Record<string, { tone: 'attention' | 'critical'; say: (on: string) => string }> = {
  sixty_days: {
    tone: 'attention',
    say: (on) => `Runs out on ${formatDate(on)}, under two months away.`,
  },
  thirty_days: {
    tone: 'attention',
    say: (on) => `Runs out on ${formatDate(on)}, under a month away.`,
  },
  expired: { tone: 'critical', say: (on) => `Ran out on ${formatDate(on)}.` },
};

/**
 * The answer carries the client it is about, so a reply that arrives after
 * the coordinator has moved on to another family is ignored rather than
 * shown under the wrong name.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'error'; clientId: string }
  | { kind: 'ready'; clientId: string; balance: BalanceResponse };

export function BalancesSection({ canWrite }: { canWrite: boolean }) {
  const { apiFetch } = useAuth();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [payingOpen, setPayingOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const clientId = client?.id ?? null;

  // Nothing is set synchronously here (react-hooks/set-state-in-effect, the
  // constraint BillingPage.tsx's own load effect notes): with no client
  // chosen the effect asks nothing at all, and every state it does reach
  // arrives from the fetch.
  const load = useCallback(() => {
    if (!clientId) {
      return;
    }
    void apiFetch(`/api/billing/clients/${clientId}/balance`)
      .then(async (res) => {
        if (!res.ok) {
          setState({ kind: 'error', clientId });
          return;
        }
        setState({ kind: 'ready', clientId, balance: BalanceResponse.parse(await res.json()) });
      })
      .catch(() => setState({ kind: 'error', clientId }));
  }, [apiFetch, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  // What is on screen right now: nothing without a client, the figures once
  // they are this client's, and the loading line in between.
  const showing: 'idle' | 'loading' | 'error' | 'ready' =
    clientId === null
      ? 'idle'
      : state.kind === 'idle' || state.clientId !== clientId
        ? 'loading'
        : state.kind;

  const columns = useMemo<Column<ServiceBalanceRow>[]>(
    () => [
      {
        key: 'service',
        header: 'Service',
        render: (row) => (
          <span className="name">
            <span>{row.serviceTypeName}</span>
          </span>
        ),
      },
      {
        key: 'progress',
        header: 'Delivered',
        // "Session 3 of 15" as a family would count it: the visits they have
        // had, out of the visits they bought, and a bar that shows the same
        // at a glance.
        render: (row) => <Progress row={row} />,
      },
      {
        key: 'remaining',
        header: 'Left',
        numeric: true,
        align: 'end',
        render: (row) => row.remaining,
      },
      {
        key: 'forfeited',
        header: 'Forfeited',
        numeric: true,
        align: 'end',
        render: (row) => row.forfeited,
      },
      {
        key: 'value',
        header: 'Value left, before VAT (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.remainingValueNetFils),
      },
      {
        key: 'expiry',
        header: 'Runs out',
        numeric: true,
        render: (row) => (row.nextExpiryOn ? formatDate(row.nextExpiryOn) : NO_EXPIRY),
      },
    ],
    [],
  );

  const balance = showing === 'ready' && state.kind === 'ready' ? state.balance : null;
  // "13 sessions, 1 brain map": what the mixed total above is made of.
  const remainingBreakdown = balance
    ? balance.services
        .filter((service) => service.remaining > 0)
        .map((service) => `${service.remaining} × ${service.serviceTypeName}`)
        .join(', ')
    : '';
  const warningFor = balance ? WARNINGS[balance.expiryWarning] : undefined;
  const warning =
    balance && balance.nextExpiryOn && warningFor
      ? { tone: warningFor.tone, text: warningFor.say(balance.nextExpiryOn) }
      : null;

  const [listRef, listWidth] = useWidth<HTMLDivElement>();
  const [balanceRef, balanceWidth] = useWidth<HTMLDivElement>();
  // On a phone the payment docks to the foot of the balance; with more room it
  // sits in the client's own header. One button, in one place or the other.
  const docked = !roomFor(balanceWidth, PAY_IN_HEADER_NEEDS);
  const payButton = canWrite ? (
    <div className={docked ? 'balance__pay balance__pay--docked' : 'balance__pay'}>
      <Button
        variant="primary"
        onClick={() => {
          setNote(null);
          setPayingOpen(true);
        }}
      >
        Record a payment
      </Button>
    </div>
  ) : null;

  return (
    <div ref={balanceRef} className="balance">
      <div className="toolbar">
        <ClientPicker id="balance-client" label="Client" selected={client} onSelect={setClient} />
      </div>

      {note ? (
        <div role="status">
          <Note>{note}</Note>
        </div>
      ) : null}
      {showing === 'idle' ? <Note>Find a client to see what they have left.</Note> : null}
      {showing === 'loading' ? <Note>Loading the balance.</Note> : null}
      {showing === 'error' ? (
        <Note tone="critical">This balance could not be loaded. Try again.</Note>
      ) : null}

      {balance && client ? (
        <>
          {/* Whose balance this is, and the one thing done from here. */}
          <section className="balance__client" aria-label="Client">
            <span className="balance__avatar" aria-hidden="true">
              {initials(client)}
            </span>
            <span className="name balance__who">
              <span className="balance__name">
                {client.givenName} {client.familyName}
              </span>
              <span className="small muted">{client.mrn}</span>
            </span>
            {docked ? null : payButton}
          </section>

          <dl className="figures balance__figures">
            <div className="figures__item">
              {/* A programme holds sessions, brain maps and a consultation,
                  so the total across them is credits — the ledger's word for
                  a mixed count. The line beneath says what they actually are,
                  in the words a family uses. */}
              <dt>Credits left</dt>
              <dd className="numeric">{balance.remaining}</dd>
              {remainingBreakdown ? <dd className="small muted">{remainingBreakdown}</dd> : null}
            </div>
            <div className="figures__item">
              <dt>Charged, with VAT (AED)</dt>
              <dd className="numeric">{formatFils(balance.chargedFils)}</dd>
            </div>
            <div className="figures__item">
              <dt>Paid</dt>
              <dd className="numeric">{formatFils(balance.paidFils)}</dd>
            </div>
            {/* Owing is the one figure that asks for something, so it is the one
                drawn in the attention wash; in credit or settled it is plain. */}
            <div
              className={`figures__item${balance.outstandingFils > 0 ? ' figures__item--owed' : ''}`}
            >
              <dt>{balance.outstandingFils < 0 ? 'In credit' : 'Outstanding'}</dt>
              <dd className="numeric">{formatFils(Math.abs(balance.outstandingFils))}</dd>
            </div>
          </dl>

          {warning ? <BillingNote tone={warning.tone}>{warning.text}</BillingNote> : null}

          <div ref={listRef} className="balance__services">
            <h2 className="figures__heading">Sessions left</h2>
            {roomFor(listWidth, TABLE_NEEDS) ? (
              <Table
                caption="Sessions this client has left"
                columns={columns}
                rows={balance.services}
                rowKey={(row) => row.serviceTypeId}
                empty="No sessions remaining yet."
              />
            ) : balance.services.length === 0 ? (
              <p className="small muted">No sessions remaining yet.</p>
            ) : (
              <ul className="service-cards" aria-label="Sessions this client has left">
                {balance.services.map((row) => (
                  <li key={row.serviceTypeId} className="service-card">
                    <span className="service-card__top">
                      <span className="service-card__name">{row.serviceTypeName}</span>
                      <span className="service-card__left numeric">{row.remaining} left</span>
                    </span>
                    <Progress row={row} />
                    <span className="small muted">
                      {row.nextExpiryOn ? `Runs out ${formatDate(row.nextExpiryOn)}` : NO_EXPIRY}
                      {row.forfeited > 0 ? `. ${row.forfeited} forfeited` : ''}
                      {`. Value left ${formatFils(row.remainingValueNetFils)} before VAT`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {balance.purchases.length > 0 ? (
            <div className="purchases">
              <h2 className="figures__heading">Packages bought</h2>
              <ul className="purchases__list">
                {balance.purchases.map((purchase) => (
                  <li key={purchase.id} className="purchases__item">
                    <span className="name">
                      <span>{purchase.packageName}</span>
                      <span className="small muted">
                        {purchase.expiresOn
                          ? `Bought ${formatDate(purchase.purchasedOn)}, runs to ${formatDate(purchase.expiresOn)}`
                          : // Sold under no term: the credits never expire, and
                            // the line says the fact rather than trailing off
                            // after the day of the sale.
                            `Bought ${formatDate(purchase.purchasedOn)}, no expiry`}
                      </span>
                      {purchase.discountReason ? (
                        // What was given away on this sale, and why — the
                        // operator's purpose for the discount round
                        // (docs/SPEC/billing.md section 2.4). The share is the
                        // combined one the purchase carries; the reason is the
                        // extra discount's own, which is the part a person
                        // decided.
                        <span className="small muted">
                          Discount {formatDiscount(purchase)}. {purchase.discountReason}
                        </span>
                      ) : null}
                    </span>
                    <span className="numeric">{formatFils(purchase.grossFils)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {docked ? payButton : null}
        </>
      ) : null}

      {payingOpen && client ? (
        <PaymentDrawer
          client={client}
          outstandingFils={balance?.outstandingFils ?? 0}
          onClose={() => setPayingOpen(false)}
          onRecorded={(summary) => {
            setPayingOpen(false);
            setNote(summary);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Six columns need about 640px to sit on a line each; below that each
 * service is a card of its own (useWidth.ts asks the list's own width).
 */
const TABLE_NEEDS = 640;

/** The compact tier's edge (docs/SPEC/responsive-console.md section 4). */
const PAY_IN_HEADER_NEEDS = 768;

/** "JV": the avatar's two letters, from the names the picker returned. */
function initials(client: ClientRow): string {
  return `${client.givenName.charAt(0)}${client.familyName.charAt(0)}`.toUpperCase();
}

/**
 * Delivered out of bought, in words and as a bar. The words are the figure; the
 * bar only repeats them, so it is hidden from a screen reader rather than read
 * twice.
 */
function Progress({ row }: { row: ServiceBalanceRow }) {
  const share = row.purchased > 0 ? Math.min(1, row.delivered / row.purchased) : 0;
  return (
    <span className="progress">
      <span className="progress__bar" aria-hidden="true">
        <span className="progress__fill" style={{ inlineSize: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="small">
        <span className="numeric">{`${row.delivered} of ${row.purchased}`}</span>
        <span className="muted"> delivered</span>
      </span>
    </span>
  );
}
