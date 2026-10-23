import { useRef, useState } from 'react';
import { isoDateIn } from '@domain/shared';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { CloseIcon } from '../../shell/components/Icons';
import { DOWNLOAD_REFUSED, downloadCsv } from '../accounting/download';
import { useDrawer } from './useDrawer';

/**
 * A household's statement of account as a PDF for a period
 * (`GET /api/billing/clients/:id/statement.pdf`). The file is fetched with the
 * bearer token and saved from an object URL (accounting/download.ts, which is
 * type-agnostic despite its name); the address carries the client's id and the
 * two dates, never a name. The server lays out the opening balance, the
 * lines and the closing balance; this drawer only chooses the period.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/** First day of the month two months back, to today: dates only, no money. */
function defaultPeriod(): { from: string; to: string } {
  const to = isoDateIn(new Date(), PRACTICE_TIME_ZONE);
  const [year, month] = to.split('-').map(Number) as [number, number];
  const back = new Date(Date.UTC(year, month - 3, 1));
  const from = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { from, to };
}

export function StatementDrawer({
  client,
  onClose,
}: {
  client: Pick<ClientRow, 'id' | 'givenName' | 'familyName'>;
  onClose: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [period] = useState(defaultPeriod);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  const ready = from !== '' && to !== '' && from <= to;

  async function download() {
    setError(null);
    setBusy(true);
    const arrived = await downloadCsv(
      apiFetch,
      `/api/billing/clients/${client.id}/statement.pdf?from=${from}&to=${to}`,
    );
    setBusy(false);
    if (!arrived) setError(DOWNLOAD_REFUSED);
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="statement-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="statement-title">Statement of account</h2>
          <p className="small muted">
            {client.givenName} {client.familyName}
          </p>
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
        <form
          className="drawer__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void download();
          }}
        >
          <DateField id="statement-from" label="From" value={from} onChange={setFrom} />
          <DateField id="statement-to" label="To" value={to} onChange={setTo} />
          {from !== '' && to !== '' && from > to ? (
            <Note tone="critical">From must be on or before To.</Note>
          ) : null}
          {error ? <Note tone="critical">{error}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !ready}>
              Download PDF
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
