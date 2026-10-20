import { useRef, useState } from 'react';
import { BalanceResponse } from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { ClientPicker } from './ClientPicker';
import { PaymentDrawer } from './PaymentDrawer';
import { useDrawer } from './useDrawer';

/**
 * Recording a payment from the receipt book (operator, 20 October 2026),
 * where money received is read: the same Record a payment drawer Balances
 * opens, after one step Balances does not need — whose payment it is.
 *
 * The family's balance is read once they are chosen, so the drawer offers
 * what they owe exactly as it does from their balance.
 */
export function RecordPaymentFlow({
  onClose,
  onRecorded,
}: {
  onClose: () => void;
  onRecorded: (summary: string) => void;
}) {
  const { apiFetch } = useAuth();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(next: ClientRow | null) {
    setClient(next);
    setOutstanding(null);
    setFailed(false);
    if (!next) return;
    try {
      const res = await apiFetch(`/api/billing/clients/${next.id}/balance`);
      if (!res.ok) throw new Error(`balance ${res.status}`);
      setOutstanding(BalanceResponse.parse(await res.json()).outstandingFils);
    } catch {
      setFailed(true);
    }
  }

  if (client && outstanding !== null) {
    return (
      <PaymentDrawer
        client={client}
        outstandingFils={outstanding}
        onClose={onClose}
        onRecorded={onRecorded}
      />
    );
  }
  return <ChooseClient client={client} failed={failed} onChoose={choose} onClose={onClose} />;
}

function ChooseClient({
  client,
  failed,
  onChoose,
  onClose,
}: {
  client: ClientRow | null;
  failed: boolean;
  onChoose: (client: ClientRow | null) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="choose-payer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="choose-payer-title">Record a payment</h2>
          <p className="small muted">Whose payment is it?</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <ClientPicker id="payment-client" label="Client" selected={client} onSelect={onChoose} />
        {client && !failed ? (
          <Note>Reading what {client.givenName}&rsquo;s family owes.</Note>
        ) : null}
        {failed ? (
          <Note tone="critical">This family&rsquo;s balance could not be read. Try again.</Note>
        ) : null}
      </div>
    </aside>
  );
}
