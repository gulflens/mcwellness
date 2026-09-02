import { useEffect, useRef } from 'react';
import { RecordTimeline } from '../audit/RecordTimeline';
import type { ClientRow } from '../../api/clients/schema';
import { CloseIcon } from '../../shell/components/Icons';
import { StatusChip } from '../../shell/components/StatusChip';

/**
 * The client's detail drawer (docs/DESIGN-BRIEF.md section 6.2: a right-side
 * drawer, never a modal dialog), with its first tab: the record timeline. The
 * client-record worktree brings the other tabs. Seeded by the trunk in PR 6.
 */
export function ClientDrawer({ client, onClose }: { client: ClientRow; onClose: () => void }) {
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
    <aside className="drawer" role="dialog" aria-labelledby="drawer-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="drawer-title">
            {client.givenName} {client.familyName}
          </h2>
          {client.givenNameAr ? (
            <p className="small muted" lang="ar" dir="rtl">
              {client.givenNameAr} {client.familyNameAr}
            </p>
          ) : null}
          <p className="drawer__facts small">
            <span className="numeric">{client.mrn}</span>
            <StatusChip status={client.status} />
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
        <h3 className="drawer__section">Timeline</h3>
        <RecordTimeline key={client.id} clientId={client.id} />
      </div>
    </aside>
  );
}
