import { useState } from 'react';
import type { ClientRecordResponse, Contact } from '../../api/clients/record-schema';
import { Button, Note } from '../../shell/components/Controls';
import { ContactForm } from './ContactForm';

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
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });

  function saved() {
    setPanel({ kind: 'closed' });
    onChanged();
  }

  return (
    <div className="tab-section">
      {record.contacts.length === 0 ? (
        <Note>No contacts yet.</Note>
      ) : (
        <ul className="record-rows">
          {record.contacts.map((contact) => (
            <li key={contact.id} className="record-row">
              <div className="record-row__main">
                <p>{RELATIONSHIP_LABELS[contact.relationship] ?? contact.relationship}</p>
                <p className="small muted">{contact.phone ?? 'No phone'}</p>
                {contact.email ? <p className="small muted">{contact.email}</p> : null}
                <ul className="record-row__flags small muted">
                  {contact.isLegalGuardian ? <li>Legal guardian</li> : null}
                  {contact.canConsent ? <li>May consent</li> : null}
                  {contact.hasEmiratesId ? <li>Emirates ID on file</li> : null}
                </ul>
              </div>
              <Button variant="quiet" onClick={() => setPanel({ kind: 'edit', contact })}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      {panel.kind === 'closed' ? (
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
