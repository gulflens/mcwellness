// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { DocumentsTab } from './DocumentsTab';
import { ErasureSection } from './ErasureSection';
import { ADMIN, LEAD_PRACTITIONER, signedInProvider } from './testActors';

/**
 * Being forgotten, as the console shows it (docs/SPEC/client-record.md
 * section 8): the step that repeats what is about to happen and will not
 * proceed without a reason, and what a record looks like afterwards.
 */

afterEach(cleanup);

const CLIENT_ID = '00000009-0000-4000-8000-0000000000a1';
const CONTACT_ID = '00000009-0000-4000-8000-0000000000a2';
const REQUEST_ID = '00000009-0000-4000-8000-0000000000a3';
const LETTER_ID = '00000009-0000-4000-8000-0000000000a4';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record: ClientRecordResponse = {
  id: CLIENT_ID,
  mrn: 'MW-000061',
  givenName: 'Willow',
  familyName: 'Creek',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '1990-02-02',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: null,
  status: 'active',
  contacts: [
    {
      id: CONTACT_ID,
      givenName: 'Iris',
      familyName: 'Creek',
      givenNameAr: null,
      familyNameAr: null,
      relationship: 'self',
      isLegalGuardian: false,
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000071',
      email: null,
      whatsappOptIn: true,
      hasEmiratesId: false,
    },
  ],
  locations: [],
  consents: [],
  goals: [],
};

const openRequest = {
  id: REQUEST_ID,
  reason: 'The household asked for their record to be removed.',
  requestedAt: '2026-09-01T06:00:00.000Z',
  requestedByContactId: CONTACT_ID,
  notifyPhone: '+971500000071',
  performedAt: null,
  letterDocumentId: null,
  letterVersion: null,
  summary: null,
  filesPending: 0,
};

const performedRequest = {
  ...openRequest,
  performedAt: '2026-09-03T06:00:00.000Z',
  letterDocumentId: LETTER_ID,
  letterVersion: '0.1-draft',
  summary: {
    contactsAnonymised: 2,
    portalAccountsArchived: 1,
    locationsReduced: 1,
    goalsCleared: 3,
    consentsUnlinked: 1,
    documentsDeleted: 4,
    documentsKept: 2,
  },
  filesPending: 0,
};

type Call = { url: string; init?: RequestInit };

function mount(
  node: React.ReactNode,
  options: {
    actor?: typeof ADMIN;
    requests?: unknown[];
    onExecute?: (init?: RequestInit) => Response;
  } = {},
): Call[] {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(options.actor ?? ADMIN);
    calls.push({ url, init });
    if (url.endsWith('/execute')) {
      return options.onExecute
        ? options.onExecute(init)
        : json({
            request: performedRequest,
            letter: { url: 'https://storage.example.com/letter', expiresInSeconds: 300 },
          });
    }
    if (url.endsWith('/erasure-requests')) return json({ requests: options.requests ?? [] });
    if (url.endsWith('/documents')) return json({ documents: [] });
    return json({ id: REQUEST_ID });
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      {node}
    </AuthProviderBoundary>,
  );
  return calls;
}

describe('a recorded request, not yet carried out', () => {
  it('says what was asked and by whom, and does not erase until it has been confirmed', async () => {
    const calls = mount(<ErasureSection record={record} mayAsk mayErase onChanged={vi.fn()} />, {
      requests: [openRequest],
    });
    expect(
      await screen.findByText('The household asked for their record to be removed.'),
    ).toBeTruthy();
    expect(screen.getByText('Iris Creek')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Erase this client' }));
    // The step repeats what will happen, in the words of the thing itself.
    expect(screen.getByText(/Invoices and credit notes are kept/)).toBeTruthy();
    expect(screen.getByText(/Only the owner and the lead practitioner may open it/)).toBeTruthy();

    // Nothing has been sent, and the button will not send anything without a reason.
    expect(calls.some((call) => call.url.endsWith('/execute'))).toBe(false);
    const confirm = screen
      .getAllByRole('button', { name: 'Erase this client' })
      .at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('sends the typed reason with the act, and never in the address', async () => {
    const onChanged = vi.fn();
    const calls = mount(<ErasureSection record={record} mayAsk mayErase onChanged={onChanged} />, {
      requests: [openRequest],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Erase this client' }));
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Erasure requested by the household on 1 September.' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Erase this client' }).at(-1) as HTMLButtonElement,
    );

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const executed = calls.find((call) => call.url.endsWith('/execute'));
    expect(executed).toBeTruthy();
    expect(new Headers(executed?.init?.headers).get('x-reason')).toBe(
      'Erasure requested by the household on 1 September.',
    );
    // The reason is a header, never a query string (.claude/rules/ui.md).
    expect(executed?.url).toBe(`/api/clients/${CLIENT_ID}/erasure-requests/${REQUEST_ID}/execute`);
  });

  it('offers no button at all to a lead practitioner, who may not carry one out', async () => {
    mount(<ErasureSection record={record} mayAsk mayErase={false} onChanged={vi.fn()} />, {
      actor: LEAD_PRACTITIONER,
      requests: [openRequest],
    });
    expect(
      await screen.findByText('Only the owner or an admin may carry out an erasure.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Erase this client' })).toBeNull();
  });
});

describe('a record that has been erased', () => {
  it('says when, what went, what was kept, and offers the letter', async () => {
    mount(
      <ErasureSection
        record={{ ...record, status: 'erased' }}
        reason="Checking the confirmation went out."
        mayAsk
        mayErase
        onChanged={vi.fn()}
      />,
      { requests: [performedRequest] },
    );
    expect(await screen.findByText(/Erased on 3 September 2026/)).toBeTruthy();
    expect(screen.getByText('4 documents deleted')).toBeTruthy();
    expect(screen.getByText(/2 invoices and credit notes, as tax law requires/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download the letter/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send it by WhatsApp' })).toBeTruthy();
    expect(screen.getByText(/draft wording, pending the practice's lawyer/)).toBeTruthy();
  });

  it('hands the number to WhatsApp only when the button is pressed, and never to the page', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    mount(
      <ErasureSection
        record={{ ...record, status: 'erased' }}
        mayAsk
        mayErase
        onChanged={vi.fn()}
      />,
      { requests: [performedRequest] },
    );
    await screen.findByText(/Erased on 3 September 2026/);
    // Before the press, the number is nowhere in the document.
    expect(document.body.innerHTML).not.toContain('971500000071');

    fireEvent.click(screen.getByRole('button', { name: 'Send it by WhatsApp' }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]?.[0]);
    expect(url.startsWith('https://wa.me/971500000071?text=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('3 September 2026');
    vi.unstubAllGlobals();
  });

  it('drafts the message in the household’s own language', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    mount(
      <ErasureSection
        record={{ ...record, status: 'erased', preferredLocale: 'ar' }}
        mayAsk
        mayErase
        onChanged={vi.fn()}
      />,
      { requests: [performedRequest] },
    );
    await screen.findByText(/Erased on 3 September 2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Send it by WhatsApp' }));
    expect(decodeURIComponent(String(open.mock.calls[0]?.[0]))).toContain('حُذف سجلك');
    vi.unstubAllGlobals();
  });
});

describe('the other tabs of an erased record', () => {
  it('says plainly what is left in Documents, and offers no way to file anything', async () => {
    mount(<DocumentsTab clientId={CLIENT_ID} mayWrite erased reason="Checking the record." />);
    expect(await screen.findByText(/What is left here is what tax law keeps/)).toBeTruthy();
    expect(screen.queryByText('File a document')).toBeNull();
  });
});
