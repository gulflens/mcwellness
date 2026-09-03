import { useEffect, useRef, useState } from 'react';
import {
  SendOptionsResponse,
  type SendDocumentResponse,
  type SendOption,
} from '../../api/billing/document-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from './useDrawer';

/**
 * "Send it" — putting an invoice or a receipt in front of the family.
 *
 * The practice sends it, not the platform. Choosing WhatsApp composes the
 * message and hands over a link that opens WhatsApp with it already written;
 * the person reads it and presses send. Email is the same shape while no email
 * vendor is approved: the message is composed and the link is handed back to
 * share. That is deliberate rather than unfinished — a family's contact details
 * do not go to a vendor nobody has approved
 * (docs/COMPLIANCE/approved-vendors.md).
 *
 * **No number and no address is on this screen.** The route answers who the
 * contacts are and whether each has a telephone or an email, and the send route
 * reads the address itself. A screen that never holds one cannot leak it.
 *
 * The drafted message is shown before it goes, because somebody about to send a
 * family a bill should be able to read what it says first.
 */

const RELATIONSHIPS: Record<string, string> = {
  self: 'Themselves',
  mother: 'Mother',
  father: 'Father',
};

const MESSAGES: Record<string, string> = {
  no_whatsapp_opt_in: 'This household has not agreed to WhatsApp. Send it another way.',
  no_usable_number: 'There is no usable telephone number on this contact.',
  no_email: 'There is no email address on this contact.',
  contact_not_found: 'That contact is no longer available. Refresh and try again.',
};
const GENERIC = 'It could not be sent. Try again.';

export function SendDrawer({
  documentId,
  clientId,
  reference,
  onClose,
}: {
  documentId: string;
  clientId: string;
  reference: string;
  onClose: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [contacts, setContacts] = useState<SendOption[] | null>(null);
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [sent, setSent] = useState<SendDocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/billing/clients/${clientId}/send-options`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setError('The contacts could not be loaded. Try again.');
          return;
        }
        const body = SendOptionsResponse.parse(await res.json());
        setContacts(body.contacts);
        setContactId(body.contacts[0]?.id ?? '');
      })
      .catch(() => {
        if (live) setError('The contacts could not be loaded. Try again.');
      });
    return () => {
      live = false;
    };
  }, [apiFetch, clientId]);

  const chosen = contacts?.find((contact) => contact.id === contactId) ?? null;

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/documents/${documentId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, contactId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(MESSAGES[body?.code ?? ''] ?? GENERIC);
        return;
      }
      setSent((await res.json()) as SendDocumentResponse);
    } catch {
      setError(GENERIC);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="send-drawer-title">Send it</h2>
          <p className="small muted">{reference}</p>
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
        {sent ? (
          <div className="drawer__form">
            <p className="small muted">This is what it says:</p>
            {/* Shown as written, both languages, before anybody sends it. */}
            <pre className="message">{sent.message}</pre>
            {sent.handoffUrl ? (
              <div className="drawer__actions">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => window.open(sent.handoffUrl, '_blank', 'noopener')}
                >
                  {sent.channel === 'whatsapp' ? 'Open WhatsApp' : 'Open the link'}
                </Button>
              </div>
            ) : (
              <Note>It has gone.</Note>
            )}
            <p className="small muted">
              {sent.channel === 'whatsapp'
                ? 'WhatsApp opens with the message written. You press send.'
                : 'The link opens the document. Attach it to your own email.'}
            </p>
          </div>
        ) : (
          <div className="drawer__form">
            <Select
              id="send-contact"
              label="Send to"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              hint="Only the people on this household's record."
            >
              {(contacts ?? []).map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name ?? RELATIONSHIPS[contact.relationship] ?? contact.relationship}
                </option>
              ))}
            </Select>

            <Select
              id="send-channel"
              label="How"
              value={channel}
              onChange={(e) => setChannel(e.target.value === 'email' ? 'email' : 'whatsapp')}
              hint={
                channel === 'whatsapp'
                  ? 'Opens WhatsApp with the message written; you press send.'
                  : 'Hands you the link to attach to your own email.'
              }
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </Select>

            {/* Said before the button, not after it fails. */}
            {chosen && channel === 'whatsapp' && !chosen.whatsappOptIn ? (
              <Note tone="critical">
                This household has not agreed to WhatsApp. Send it another way.
              </Note>
            ) : null}
            {chosen && channel === 'email' && !chosen.hasEmail ? (
              <Note tone="critical">There is no email address on this contact.</Note>
            ) : null}

            {error ? <Note tone="critical">{error}</Note> : null}

            <div className="drawer__actions">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void send()}
                disabled={busy || contactId === ''}
              >
                {busy ? 'Preparing…' : 'Prepare it'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
