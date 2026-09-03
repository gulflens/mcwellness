import { useEffect, useRef, useState } from 'react';
import { RecordTimeline } from '../audit/RecordTimeline';
import type { ClientRow } from '../../api/clients/schema';
import { CloseIcon } from '../../shell/components/Icons';
import { Button, Field, Note } from '../../shell/components/Controls';
import { ClientStatusChip } from '../../shell/components/StatusChip';
import { ConsentTab } from './ConsentTab';
import { ContactsTab } from './ContactsTab';
import { DocumentsTab } from './DocumentsTab';
import { GoalsTab } from './GoalsTab';
import { LocationsTab } from './LocationsTab';
import { OverviewTab } from './OverviewTab';
import { Tabs, TabPanel, type Tab } from './Tabs';
import { useClientRecord } from './useClientRecord';

const TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'locations', label: 'Locations' },
  { id: 'consent', label: 'Consent' },
  { id: 'goals', label: 'Goals' },
  { id: 'documents', label: 'Documents' },
  { id: 'timeline', label: 'Timeline' },
];
const DEFAULT_TAB = 'overview';

/**
 * The client's detail drawer (docs/DESIGN-BRIEF.md section 6.2: a right-side
 * drawer, never a modal dialog). One fetch of GET /api/clients/:id on open
 * (the server audits the read); tabs switch client-side (task brief item 1).
 * Seeded by the trunk in PR 6 with its first tab, Timeline; the
 * client-record worktree brings the rest here.
 */
export function ClientDrawer({ client, onClose }: { client: ClientRow; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // The tab lives in the drawer's own state, not in the address bar: this drawer is
  // opened by a row click and is not addressable by URL (the shell owns the routes,
  // and the sibling screens keep their drawers the same way), so a fragment would
  // promise a persistence it cannot keep and would carry one client's tab onto the
  // next. Every client opens on Overview.
  const [tab, setTab] = useState<string>(DEFAULT_TAB);
  const [reason, setReason] = useState('');
  const { state, refetch } = useClientRecord(client.id);

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
            {/* The record's own status once it has loaded: activating from Overview must
                not leave the header still saying "lead" against a row the list fetched
                before the change. */}
            <ClientStatusChip
              status={state.kind === 'ready' ? state.record.status : client.status}
            />
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
        <Tabs tabs={TABS} selected={tab} onSelect={setTab} idPrefix="client" />

        {state.kind === 'loading' ? <Note>Loading the record.</Note> : null}
        {state.kind === 'error' ? (
          <Note tone="critical">The record could not be loaded. Try again.</Note>
        ) : null}
        {state.kind === 'reason-required' ? (
          <div className="tab-section">
            <Note>This record has been erased. Opening it is logged; say why you need to.</Note>
            <Field
              id="drawer-reason"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={!reason.trim()}
              onClick={() => void refetch(reason.trim())}
            >
              View record
            </Button>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <TabPanel id="overview" idPrefix="client" selected={tab}>
              <OverviewTab record={state.record} onChanged={() => void refetch()} />
            </TabPanel>
            <TabPanel id="contacts" idPrefix="client" selected={tab}>
              <ContactsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch()}
              />
            </TabPanel>
            <TabPanel id="locations" idPrefix="client" selected={tab}>
              <LocationsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch()}
              />
            </TabPanel>
            <TabPanel id="consent" idPrefix="client" selected={tab}>
              <ConsentTab record={state.record} />
            </TabPanel>
            <TabPanel id="goals" idPrefix="client" selected={tab}>
              <GoalsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch()}
              />
            </TabPanel>
            <TabPanel id="documents" idPrefix="client" selected={tab}>
              <DocumentsTab />
            </TabPanel>
          </>
        ) : null}
        <TabPanel id="timeline" idPrefix="client" selected={tab}>
          <RecordTimeline key={client.id} clientId={client.id} />
        </TabPanel>
      </div>
    </aside>
  );
}
