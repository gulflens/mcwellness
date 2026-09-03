import { useCallback, useEffect, useMemo, useState } from 'react';
import { BalanceResponse, type ServiceBalanceRow } from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { formatDate } from './BillingPage';
import { ClientPicker } from './ClientPicker';
import { formatFils } from './money';
import { PaymentDrawer } from './PaymentDrawer';

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
 */

const WARNINGS: Record<string, (on: string) => string> = {
  sixty_days: (on) => `Runs out on ${formatDate(on)}, under two months away.`,
  thirty_days: (on) => `Runs out on ${formatDate(on)}, under a month away.`,
  expired: (on) => `Ran out on ${formatDate(on)}.`,
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
            {row.serviceTypeNameAr ? (
              <span className="name__ar small muted" lang="ar" dir="rtl">
                {row.serviceTypeNameAr}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'progress',
        header: 'Delivered',
        numeric: true,
        align: 'end',
        // "Session 3 of 15" as a family would count it: the visits they have
        // had, out of the visits they bought.
        render: (row) => `${row.delivered} of ${row.purchased}`,
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
        header: 'Value left (AED)',
        numeric: true,
        align: 'end',
        render: (row) => formatFils(row.remainingValueNetFils),
      },
      {
        key: 'expiry',
        header: 'Runs out',
        numeric: true,
        render: (row) => (row.nextExpiryOn ? formatDate(row.nextExpiryOn) : '—'),
      },
    ],
    [],
  );

  const balance = showing === 'ready' && state.kind === 'ready' ? state.balance : null;
  const warning =
    balance && balance.nextExpiryOn && WARNINGS[balance.expiryWarning]
      ? WARNINGS[balance.expiryWarning]?.(balance.nextExpiryOn)
      : null;

  return (
    <>
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

      {balance ? (
        <>
          <dl className="figures">
            <div className="figures__item">
              <dt>Sessions left</dt>
              <dd className="numeric">{balance.remaining}</dd>
            </div>
            <div className="figures__item">
              <dt>Charged (AED)</dt>
              <dd className="numeric">{formatFils(balance.chargedFils)}</dd>
            </div>
            <div className="figures__item">
              <dt>Paid</dt>
              <dd className="numeric">{formatFils(balance.paidFils)}</dd>
            </div>
            <div className="figures__item">
              <dt>{balance.outstandingFils < 0 ? 'In credit' : 'Outstanding'}</dt>
              <dd className="numeric">{formatFils(Math.abs(balance.outstandingFils))}</dd>
            </div>
          </dl>

          {warning ? <Note>{warning}</Note> : null}

          {canWrite ? (
            <div className="section__actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setNote(null);
                  setPayingOpen(true);
                }}
              >
                Record a payment
              </Button>
            </div>
          ) : null}

          <Table
            caption="What this client has left"
            columns={columns}
            rows={balance.services}
            rowKey={(row) => row.serviceTypeId}
            empty="This client holds no credits yet."
          />

          {balance.purchases.length > 0 ? (
            <div className="purchases">
              <h2 className="figures__heading">Packages bought</h2>
              <ul className="purchases__list">
                {balance.purchases.map((purchase) => (
                  <li key={purchase.id} className="purchases__item">
                    <span className="name">
                      <span>{purchase.packageName}</span>
                      <span className="small muted">
                        Bought {formatDate(purchase.purchasedOn)}, runs to{' '}
                        {formatDate(purchase.extendedTo ?? purchase.expiresOn)}
                      </span>
                    </span>
                    <span className="numeric">{formatFils(purchase.grossFils)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
    </>
  );
}
