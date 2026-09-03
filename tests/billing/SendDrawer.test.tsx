// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendDrawer } from '../../app/admin/billing/SendDrawer';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * Sending a document to a family.
 *
 * The two things worth proving on this screen: no telephone number and no email
 * address is ever on it, and the drafted message is shown before anybody sends
 * anything.
 */

const DOCUMENT_ID = '00000006-0000-4000-8000-000000000001';
const CLIENT_ID = '00000005-0000-4000-8000-000000000002';

const CONTACTS = [
  {
    id: '00000009-0000-4000-8000-000000000001',
    name: 'Rowan Meadow',
    relationship: 'self',
    hasPhone: true,
    hasEmail: true,
    whatsappOptIn: true,
  },
  {
    id: '00000009-0000-4000-8000-000000000002',
    name: 'Hazel Harbour',
    relationship: 'mother',
    hasPhone: true,
    hasEmail: false,
    whatsappOptIn: false,
  },
];

const MESSAGE =
  'Your invoice INV-000002 from Synthetic Wellness Studio is ready. ' +
  'You can open it here: https://example.com/signed';

function mount(routes: (url: string, init?: RequestInit) => Response | null) {
  return mountWith(
    OWNER,
    <SendDrawer
      documentId={DOCUMENT_ID}
      clientId={CLIENT_ID}
      reference="INV-000002"
      onClose={() => undefined}
    />,
    routes,
  );
}

const contactsRoute = (url: string) =>
  url === `/api/billing/clients/${CLIENT_ID}/send-options` ? json({ contacts: CONTACTS }) : null;

describe('choosing who to send to', () => {
  it('offers the household’s own contacts by name', async () => {
    mount(contactsRoute);
    expect(await screen.findByRole('option', { name: 'Rowan Meadow' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Hazel Harbour' })).toBeTruthy();
  });

  it('shows no telephone number and no email address anywhere', async () => {
    // The route does not answer them and the screen never holds one: a screen
    // that never has an address cannot leak it into a log or a stray copy.
    mount(contactsRoute);
    await screen.findByRole('option', { name: 'Rowan Meadow' });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\+?\d{9,}/);
    expect(text).not.toContain('@');
  });

  it('says before the button that a household has not agreed to WhatsApp', async () => {
    mount(contactsRoute);
    const picker = await screen.findByLabelText('Send to');
    fireEvent.change(picker, { target: { value: CONTACTS[1]?.id } });
    expect(
      await screen.findByText('This household has not agreed to WhatsApp. Send it another way.'),
    ).toBeTruthy();
  });

  it('says before the button that a contact has no email address', async () => {
    mount(contactsRoute);
    const picker = await screen.findByLabelText('Send to');
    fireEvent.change(picker, { target: { value: CONTACTS[1]?.id } });
    fireEvent.change(screen.getByLabelText('How'), { target: { value: 'email' } });
    expect(await screen.findByText('There is no email address on this contact.')).toBeTruthy();
  });
});

describe('preparing the message', () => {
  it('shows what it says before anybody sends it, and hands over the hand-off', async () => {
    vi.stubGlobal('open', () => undefined);
    mount((url, init) => {
      const contacts = contactsRoute(url);
      if (contacts) return contacts;
      if (url === `/api/billing/documents/${DOCUMENT_ID}/send` && init?.method === 'POST') {
        return json({
          channel: 'whatsapp',
          delivered: false,
          handoffUrl: 'https://wa.me/971500000012?text=hello',
          message: MESSAGE,
        });
      }
      return null;
    });

    await screen.findByRole('option', { name: 'Rowan Meadow' });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare it' }));

    // The practice reads it, then presses send in WhatsApp itself.
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open WhatsApp' })).toBeTruthy();
    expect(
      screen.getByText('WhatsApp opens with the message written. You press send.'),
    ).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('names the refusal when the send is turned down', async () => {
    mount((url, init) => {
      const contacts = contactsRoute(url);
      if (contacts) return contacts;
      if (url === `/api/billing/documents/${DOCUMENT_ID}/send` && init?.method === 'POST') {
        return json({ error: 'unprocessable', code: 'no_usable_number' }, 422);
      }
      return null;
    });

    await screen.findByRole('option', { name: 'Rowan Meadow' });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare it' }));
    expect(
      await screen.findByText('There is no usable telephone number on this contact.'),
    ).toBeTruthy();
  });
});
