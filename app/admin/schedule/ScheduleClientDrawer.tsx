import { useEffect, useRef } from 'react';
import { RecordTimeline } from '../audit/RecordTimeline';
import type { AppointmentRow } from '../../api/appointments/schema';
import { CloseIcon } from '../../shell/components/Icons';

/**
 * The day schedule's own client drawer, opened from the client link on a
 * stop's row (DESIGN.md "The Drawer": beside the ledger, never a modal). It
 * is not `app/admin/clients/ClientDrawer.tsx` reused: that one is typed to
 * the clients table's own `ClientRow` (record number, status, contact,
 * emirate), and `app/admin/clients/**` sits outside this pull request's edit
 * paths (docs/SPEC/OWNERSHIP.md). `AppointmentRow.client` carries only
 * identity — id, name, and the Arabic name, which travels but is not shown:
 * the console is English only (operator's decision of 7 September 2026,
 * docs/DESIGN-BRIEF.md section 10 item 4). So this drawer shows the name, plus
 * the record timeline, which needs nothing but the id.
 */
export function ScheduleClientDrawer({
  client,
  onClose,
}: {
  client: AppointmentRow['client'];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <aside className="drawer" role="dialog" aria-labelledby="schedule-client-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="schedule-client-title">
            {client.givenName} {client.familyName}
          </h2>
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
        <h3 className="drawer__section">Timeline</h3>
        <RecordTimeline key={client.id} clientId={client.id} />
      </div>
    </aside>
  );
}
