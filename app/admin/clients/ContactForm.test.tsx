// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import {
  CreateContactBody,
  UpdateContactBody,
  type Contact,
} from '../../api/clients/record-schema';
import { ContactForm } from './ContactForm';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const CLIENT_ID = '00000008-0000-4000-8000-0000000000c1';
const contact: Contact = {
  id: '00000008-0000-4000-8000-0000000000c2',
  givenName: 'Dahlia',
  familyName: 'Creek',
  givenNameAr: 'داليا',
  familyNameAr: 'خور',
  relationship: 'mother',
  isLegalGuardian: true,
  canConsent: true,
  canReceiveReports: true,
  canPay: false,
  phone: '+971500000041',
  email: null,
  whatsappOptIn: false,
  hasEmiratesId: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(existing?: Contact) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const onSaved = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return json({ id: contact.id }, existing ? 200 : 201);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <ContactForm clientId={CLIENT_ID} contact={existing} onSaved={onSaved} onCancel={vi.fn()} />
    </AuthProviderBoundary>,
  );
  return { calls, onSaved };
}

function bodyOf(call: { init?: RequestInit } | undefined): unknown {
  return JSON.parse(String(call?.init?.body));
}

describe('ContactForm', () => {
  it('omits a blank phone and email when adding, rather than sending null', async () => {
    const { calls, onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Relationship to the client'), {
      target: { value: 'guardian' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = bodyOf(calls[0]);
    // The create body takes these as optional, not nullable: null is a 400, so a
    // contact added with no phone must simply not carry the field.
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('email');
    // Parsed with the route's own schema, so the assertion cannot drift from it.
    expect(CreateContactBody.safeParse(body).success).toBe(true);
  });

  it('clears a phone with null when editing, which the edit body accepts', async () => {
    const { calls, onSaved } = mount(contact);
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({ phone: null });
    expect(UpdateContactBody.safeParse(body).success).toBe(true);
    // The console is English only (docs/DESIGN-BRIEF.md section 10 item 4) and
    // this form no longer holds the Arabic name — but the contact on file has
    // one. An edit must leave it where it is, which the PATCH does only if the
    // body never mentions the key (app/api/clients/contacts.ts lines 159-162:
    // `if (d.givenNameAr !== undefined)`).
    expect(body).not.toHaveProperty('givenNameAr');
    expect(body).not.toHaveProperty('familyNameAr');
  });

  it('refuses an Emirates ID that fails its checksum before any request is made', async () => {
    const { calls } = mount();
    fireEvent.change(screen.getByLabelText('Relationship to the client'), {
      target: { value: 'self' },
    });
    fireEvent.change(screen.getByLabelText('Emirates ID (optional)'), {
      target: { value: '784-1900-0000000-0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    expect(
      await screen.findByText('Enter fifteen digits starting 784, or leave this blank.'),
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows example values as hints, never as grey text inside the box', () => {
    mount();
    const phone = screen.getByLabelText('Phone (optional)') as HTMLInputElement;
    const emiratesId = screen.getByLabelText('Emirates ID (optional)') as HTMLInputElement;
    expect(phone.placeholder).toBe('');
    expect(emiratesId.placeholder).toBe('');
    expect(screen.getByText(/for example 784-1900-1234567-1/i)).toBeTruthy();
  });
});
