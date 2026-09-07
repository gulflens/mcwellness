import { useState } from 'react';
import type { ClientRecordResponse, Contact } from '../../api/clients/record-schema';
import { Button, Note } from '../../shell/components/Controls';
import { ContactForm } from './ContactForm';
import { contactName } from './contactName';

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

type Panel = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; contact: Contact };

/**
 * Contacts (docs/SPEC/client-record.md section 4.2): list, add, edit, with
 * the legal-guardian and may-consent flags visible — activation reads
 * exactly these two (domain/client's canActivate).
 */
export function ContactsTab({
  clientId,
  record,
  onChanged,
  mayWrite,
  erased = false,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the write routes would refuse: no Add, no Edit. */
  mayWrite: boolean;
  /**
   * Whether this record has been erased. Passed rather than read from
   * `record.status`, because the drawer knows it one act before the record
   * does (app/admin/clients/ClientDrawer.tsx).
   */
  erased?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });

  function saved() {
    setPanel({ kind: 'closed' });
    onChanged();
  }

  return (
    <div className="tab-section">
      {erased ? (
        <Note tone="attention">
          This record has been erased. What was here is gone: the contacts keep their relationship
          to the client and nothing else.
        </Note>
      ) : null}
      {record.contacts.length === 0 ? (
        <Note>No contacts yet.</Note>
      ) : (
        <ul className="record-rows">
          {record.contacts.map((contact) => (
            <li key={contact.id} className="record-row">
              <div className="record-row__main">
                {/* The name leads and the relationship follows it, because who
                    to ask for at the door is the name; a contact with no name
                    on file still reads as the relationship alone (CR-07). */}
                <p>
                  {contactName(contact) ??
                    RELATIONSHIP_LABELS[contact.relationship] ??
                    contact.relationship}
                </p>
                {contactName(contact) ? (
                  <p className="small muted">
                    {RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship}
                  </p>
                ) : null}
                <p className="small muted">{contact.phone ?? 'No phone'}</p>
                {contact.email ? <p className="small muted">{contact.email}</p> : null}
                <ul className="record-row__flags small muted">
                  {contact.isLegalGuardian ? <li>Legal guardian</li> : null}
                  {contact.canConsent ? <li>May consent</li> : null}
                  {contact.hasEmiratesId ? <li>Emirates ID on file</li> : null}
                </ul>
              </div>
              {mayWrite ? (
                <div className="record-row__actions">
                  <Button variant="quiet" onClick={() => setPanel({ kind: 'edit', contact })}>
                    Edit
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayWrite && panel.kind === 'closed' ? (
        <Button variant="secondary" onClick={() => setPanel({ kind: 'add' })}>
          Add contact
        </Button>
      ) : null}
      {panel.kind === 'add' ? (
        <ContactForm
          clientId={clientId}
          onSaved={saved}
          onCancel={() => setPanel({ kind: 'closed' })}
        />
      ) : null}
      {panel.kind === 'edit' ? (
        <ContactForm
          clientId={clientId}
          contact={panel.contact}
          onSaved={saved}
          onCancel={() => setPanel({ kind: 'closed' })}
        />
      ) : null}
    </div>
  );
}
