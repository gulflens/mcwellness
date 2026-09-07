import { useEffect, useRef, useState } from 'react';
import { AssessmentsTab } from '../assessments/AssessmentsTab';
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
import { ReportsTab } from '../reports/ReportsTab';
import { Tabs, TabPanel, type Tab } from './Tabs';
import { canSeeFullRecord, canWriteGoals, canWriteRecord } from './clientAccess';
import { clientHeadingName } from './contactName';
import { useAuth } from '../../shell/auth/AuthContext';
import { useClientRecord } from './useClientRecord';

const ALL_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'locations', label: 'Locations' },
  { id: 'consent', label: 'Consent' },
  { id: 'goals', label: 'Goals' },
  { id: 'documents', label: 'Documents' },
  // Piece ten's measurements (docs/SPEC/assessment.md section 3.1;
  // docs/CHANGE-REQUESTS/assessment-01.md item 3). It sits after Documents and
  // before Timeline because a measurement is something the practice holds
  // about this client, and Timeline is the record of what was done to the
  // record itself.
  { id: 'assessments', label: 'Assessments' },
  // The reports stream's own tab, mounted here by
  // docs/CHANGE-REQUESTS/reports-01.md item 3. It follows the measurements it
  // quotes. Nothing else in this file moves.
  { id: 'reports', label: 'Reports' },
  { id: 'timeline', label: 'Timeline' },
];
/**
 * Finance reads demographics and contacts, and nothing else
 * (docs/SPEC/client-record.md section 2 and rule 6). The read policies already
 * refuse the rest, so the four tabs left out would open onto nothing they could
 * fill; the screen matches the rule rather than discovering it.
 */
const FINANCE_TABS: readonly Tab[] = ALL_TABS.filter((tab) =>
  ['overview', 'contacts', 'timeline'].includes(tab.id),
);
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
  // Set the moment this record is erased from the Overview tab, and not by
  // asking the server: the person who pressed the button may be an admin, and
  // an admin may not open an erased record (docs/SPEC/client-record.md section
  // 2). A refetch would answer 403 and this drawer would say the record could
  // not be loaded, immediately after an irreversible act succeeded. So the
  // drawer takes the fact from the panel that did it — the status it shows,
  // and the reason its own routes now ask for.
  const [erasedHere, setErasedHere] = useState(false);
  const { state, refetch } = useClientRecord(client.id);
  const { session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  const now = new Date();
  const erased = erasedHere || (state.kind === 'ready' && state.record.status === 'erased');
  // Nothing is written to an erased record, by anyone: the routes refuse it
  // and the policies refuse it under them, so no tab offers it either.
  const mayWrite = canWriteRecord(actor, now) && !erased;
  const mayWriteGoals = canWriteGoals(actor) && !erased;
  const tabs = canSeeFullRecord(actor) ? ALL_TABS : FINANCE_TABS;

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
            {erased
              ? clientHeadingName('Erased client', 'Erased client')
              : clientHeadingName(client.givenName, client.familyName)}
          </h2>
          {/* The console is English only (operator's decision of 7 September
              2026, docs/DESIGN-BRIEF.md section 10 item 4); the Arabic name
              stays on the wire for the portal and the documents. */}
          <p className="drawer__facts small">
            <span className="numeric">{client.mrn}</span>
            {/* The record's own status once it has loaded: activating from Overview must
                not leave the header still saying "lead" against a row the list fetched
                before the change. */}
            <ClientStatusChip
              status={
                erased ? 'erased' : state.kind === 'ready' ? state.record.status : client.status
              }
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
        <Tabs tabs={tabs} selected={tab} onSelect={setTab} idPrefix="client" />

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
              <OverviewTab
                record={state.record}
                onChanged={() => void refetch(reason.trim() || undefined)}
                mayWrite={mayWrite}
                reason={reason.trim() || undefined}
                onErased={(erasureReason) => {
                  setErasedHere(true);
                  // The reason it was erased with becomes the reason this
                  // drawer holds, so an owner or a lead practitioner reading
                  // the record afterwards is not bounced to the reason prompt
                  // for a record they are standing in front of.
                  if (!reason.trim()) setReason(erasureReason);
                }}
              />
            </TabPanel>
            <TabPanel id="contacts" idPrefix="client" selected={tab}>
              <ContactsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch(reason.trim() || undefined)}
                mayWrite={mayWrite}
                erased={erased}
              />
            </TabPanel>
            <TabPanel id="locations" idPrefix="client" selected={tab}>
              <LocationsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch(reason.trim() || undefined)}
                mayWrite={mayWrite}
                erased={erased}
              />
            </TabPanel>
            <TabPanel id="consent" idPrefix="client" selected={tab}>
              <ConsentTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch(reason.trim() || undefined)}
                mayWrite={mayWrite}
                erased={erased}
              />
            </TabPanel>
            <TabPanel id="goals" idPrefix="client" selected={tab}>
              <GoalsTab
                clientId={client.id}
                record={state.record}
                onChanged={() => void refetch(reason.trim() || undefined)}
                mayWrite={mayWriteGoals}
                erased={erased}
              />
            </TabPanel>
            <TabPanel id="documents" idPrefix="client" selected={tab}>
              <DocumentsTab
                clientId={client.id}
                mayWrite={mayWrite}
                erased={erased}
                reason={reason.trim() || undefined}
              />
            </TabPanel>
            <TabPanel id="assessments" idPrefix="client" selected={tab}>
              <AssessmentsTab clientId={client.id} />
            </TabPanel>
            <TabPanel id="reports" idPrefix="client" selected={tab}>
              <ReportsTab clientId={client.id} erased={erased} />
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
