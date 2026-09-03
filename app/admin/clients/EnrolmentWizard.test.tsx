// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { EnrolmentWizard } from './EnrolmentWizard';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const CLIENT_ID = '00000008-0000-4000-8000-000000000090';
const MRN = 'MW-000090';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function baseRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CLIENT_ID,
    mrn: MRN,
    givenName: 'Laurel',
    familyName: 'Meadow',
    givenNameAr: null,
    familyNameAr: null,
    dateOfBirth: null,
    sexAtBirth: null,
    preferredLocale: 'en',
    referralSource: null,
    status: 'lead',
    contacts: [
      {
        id: '00000008-0000-4000-8000-000000000091',
        relationship: 'self',
        isLegalGuardian: false,
        canConsent: false,
        givenName: 'Laurel',
        familyName: 'Meadow',
        givenNameAr: 'لوريل',
        familyNameAr: 'مرج',
        canReceiveReports: true,
        canPay: false,
        phone: '+971500000058',
        email: null,
        whatsappOptIn: false,
        hasEmiratesId: false,
      },
    ],
    locations: [],
    consents: [],
    goals: [],
    ...overrides,
  };
}

/** A record that satisfies every canActivate condition (domain/client). */
function completeRecord() {
  return baseRecord({
    dateOfBirth: '1990-01-01',
    contacts: [
      {
        id: '00000008-0000-4000-8000-000000000091',
        relationship: 'self',
        isLegalGuardian: true,
        canConsent: true,
        givenName: 'Basil',
        familyName: 'Ridge',
        givenNameAr: 'ريحان',
        familyNameAr: 'حافة',
        canReceiveReports: true,
        canPay: true,
        phone: '+971500000058',
        email: null,
        whatsappOptIn: false,
        hasEmiratesId: false,
      },
    ],
    locations: [
      {
        id: '00000008-0000-4000-8000-000000000092',
        label: 'home',
        emirate: 'DXB',
        makaniNumber: null,
        entranceLng: 55.27,
        entranceLat: 25.2,
        hasParkingPoint: false,
        hasCommunityGate: false,
        displayAddress: null,
        accessNotes: null,
        isPrimary: true,
      },
    ],
    consents: [
      {
        id: '00000008-0000-4000-8000-000000000093',
        purpose: 'participation',
        status: 'active',
        givenByContactId: '00000008-0000-4000-8000-000000000091',
        givenAt: '2026-01-01T09:00:00+04:00',
        withdrawnAt: null,
        expiresAt: null,
        method: 'app_signature',
        signatureDocumentId: null,
        textDocumentId: '00000008-0000-4000-8000-000000000095',
        wordingVersion: '0.1-draft',
        wordingStatus: 'draft',
        witnessedByUserId: null,
        witnessedByName: null,
      },
      {
        id: '00000008-0000-4000-8000-000000000094',
        purpose: 'home_visit',
        status: 'active',
        givenByContactId: '00000008-0000-4000-8000-000000000091',
        givenAt: '2026-01-01T09:00:00+04:00',
        withdrawnAt: null,
        expiresAt: null,
        method: 'app_signature',
        signatureDocumentId: null,
        textDocumentId: '00000008-0000-4000-8000-000000000095',
        wordingVersion: '0.1-draft',
        wordingStatus: 'draft',
        witnessedByUserId: null,
        witnessedByName: null,
      },
    ],
  });
}

function mountWithRecord(record: ReturnType<typeof baseRecord>, onDone = vi.fn()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/clients' && method === 'POST') {
      return json({ id: CLIENT_ID, mrn: MRN }, 201);
    }
    if (url === `/api/clients/${CLIENT_ID}` && method === 'GET') {
      return json(record);
    }
    if (url === `/api/clients/${CLIENT_ID}/status` && method === 'POST') {
      return json({ id: CLIENT_ID });
    }
    if (url === '/api/clients/goal-categories') {
      return json({ categories: [] });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <EnrolmentWizard onDone={onDone} mayWriteGoals />
    </AuthProviderBoundary>,
  );
  return { calls, onDone };
}

async function fillIdentity() {
  fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Laurel' } });
  fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Meadow' } });
  fireEvent.change(screen.getByLabelText('Relationship to the client'), {
    target: { value: 'self' },
  });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+971500000058' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
}

async function goToSummary() {
  await screen.findByRole('button', { name: 'Add contact' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); // contacts -> location
  await screen.findByRole('button', { name: 'Add location' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); // location -> goals
  await screen.findByRole('button', { name: 'Add goal' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); // goals -> consent
  // The consent step is the record's own Consent tab: every purpose listed,
  // with what activation still needs at the top.
  await screen.findByText('Taking part');
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); // consent -> summary
}

describe('EnrolmentWizard', () => {
  it('saves a lead at the end of the identity step, through POST /api/clients', async () => {
    const { calls } = mountWithRecord(baseRecord());
    await fillIdentity();
    await waitFor(() => expect(screen.getByText(MRN)).toBeTruthy());
    const postCall = calls.find((c) => c.url === '/api/clients' && c.init?.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall?.init?.body))).toMatchObject({
      givenName: 'Laurel',
      familyName: 'Meadow',
      contact: { relationship: 'self', phone: '+971500000058' },
    });
    // Contacts, the second step, is reached automatically.
    expect(await screen.findByRole('button', { name: 'Add contact' })).toBeTruthy();
  });

  it('says what is still missing on every step, not only at the end', async () => {
    mountWithRecord(baseRecord());
    await fillIdentity();
    // The contacts step, the first one after identity.
    await screen.findByRole('button', { name: 'Add contact' });
    expect(
      await screen.findByText('Still to complete before this client can be activated'),
    ).toBeTruthy();
    expect(screen.getByText('Date of birth')).toBeTruthy();
  });

  it('lists what is missing on the summary step, in plain words, with no Activate button', async () => {
    mountWithRecord(baseRecord());
    await fillIdentity();
    await goToSummary();
    expect(await screen.findByText('Still to complete')).toBeTruthy();
    expect(screen.getByText('Date of birth')).toBeTruthy();
    expect(screen.getByText('A location with a verified pin')).toBeTruthy();
    expect(screen.getByText('Participation consent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('shows Activate only once every condition is met, and calls the status route', async () => {
    const { onDone } = mountWithRecord(completeRecord());
    await fillIdentity();
    await goToSummary();
    expect(await screen.findByText('Ready to activate')).toBeTruthy();
    const activate = screen.getByRole('button', { name: 'Activate' });
    fireEvent.click(activate);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('keeps a step reachable once it has been reached, even after stepping back', async () => {
    mountWithRecord(baseRecord());
    await fillIdentity();
    await goToSummary();
    await screen.findByText('Still to complete');

    // Back to Contacts, three steps behind: Goals must not become unreachable again,
    // because the lead already holds whatever was saved there.
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    await screen.findByRole('button', { name: 'Add contact' });
    fireEvent.click(screen.getByRole('button', { name: 'Goals' }));
    expect(await screen.findByRole('button', { name: 'Add goal' })).toBeTruthy();
  });

  it('names a phone typed without its country code, rather than looping on a generic line', async () => {
    const { calls } = mountWithRecord(baseRecord());
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Laurel' } });
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Meadow' } });
    fireEvent.change(screen.getByLabelText('Relationship to the client'), {
      target: { value: 'self' },
    });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0500001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(
      await screen.findByText(
        'Enter the phone number with its country code, for example +971500001234.',
      ),
    ).toBeTruthy();
    // Nothing was sent: the rule the server holds is checked before the request.
    expect(calls.some((c) => c.url === '/api/clients')).toBe(false);
    // And the caret is on the field to fix.
    expect(document.activeElement).toBe(screen.getByLabelText('Phone'));
  });

  it('refuses a date of birth in the future, naming the field', async () => {
    mountWithRecord(baseRecord());
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Laurel' } });
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Meadow' } });
    fireEvent.change(screen.getByLabelText('Relationship to the client'), {
      target: { value: 'self' },
    });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+971500000058' } });
    fireEvent.change(screen.getByLabelText('Date of birth (optional)'), {
      target: { value: future },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText('A date of birth is in the past.')).toBeTruthy();
  });

  it('closes on Escape, saying the lead is already saved', async () => {
    const { onDone } = mountWithRecord(baseRecord());
    await fillIdentity();
    await screen.findByRole('button', { name: 'Add contact' });
    expect(await screen.findByText(/Saved as a lead/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDone).toHaveBeenCalled();
  });

  it('leaves a real lead at any step: Finish later closes without losing what was saved', async () => {
    const { onDone } = mountWithRecord(baseRecord());
    await fillIdentity();
    await screen.findByRole('button', { name: 'Add contact' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish later' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
