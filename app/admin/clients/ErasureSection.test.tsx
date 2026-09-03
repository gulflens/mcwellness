// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { ClientDrawer } from './ClientDrawer';
import { ConsentTab } from './ConsentTab';
import { ContactsTab } from './ContactsTab';
import { DocumentsTab } from './DocumentsTab';
import { ErasureSection } from './ErasureSection';
import { GoalsTab } from './GoalsTab';
import { LocationsTab } from './LocationsTab';
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
  performedByName: null,
  performedReason: null,
  letterDocumentId: null,
  letterVersion: null,
  letterSentAt: null,
  summary: null,
  filesPending: 0,
};

const performedRequest = {
  ...openRequest,
  performedAt: '2026-09-03T06:00:00.000Z',
  performedByName: 'Hazel Ridge',
  performedReason: 'Erasure requested by the household.',
  letterDocumentId: LETTER_ID,
  letterVersion: '0.2-draft',
  summary: {
    contactsAnonymised: 1,
    portalAccountsArchived: 1,
    locationsReduced: 1,
    goalsCleared: 3,
    consentsUnlinked: 1,
    documentsDeleted: 4,
    documentsKept: 2,
    paymentsCleared: 1,
    sessionsCleared: 6,
    sessionEventsCleared: 40,
    visitActualsCleared: 2,
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
    expect(screen.getByText(/Invoices and receipts are kept for five years/)).toBeTruthy();
    expect(
      screen.getByText(/The visit record loses where the practitioner checked in/),
    ).toBeTruthy();

    // Nothing has been sent, and the button will not send anything without a reason.
    expect(calls.some((call) => call.url.endsWith('/execute'))).toBe(false);
    const confirm = screen
      .getAllByRole('button', { name: 'Erase this client' })
      .at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('sends the typed reason with the act, and never in the address', async () => {
    const onErased = vi.fn();
    const calls = mount(<ErasureSection record={record} mayAsk mayErase onErased={onErased} />, {
      requests: [openRequest],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Erase this client' }));
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Erasure requested by the household on 1 September.' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Erase this client' }).at(-1) as HTMLButtonElement,
    );

    await waitFor(() => expect(onErased).toHaveBeenCalled());
    // The drawer is handed the reason, so an owner or a lead is not bounced to
    // the reason prompt for a record they are standing in front of.
    expect(onErased).toHaveBeenCalledWith('Erasure requested by the household on 1 September.');
    const executed = calls.find((call) => call.url.endsWith('/execute'));
    expect(executed).toBeTruthy();
    expect(new Headers(executed?.init?.headers).get('x-reason')).toBe(
      'Erasure requested by the household on 1 September.',
    );
    // The reason is a header, never a query string (.claude/rules/ui.md).
    expect(executed?.url).toBe(`/api/clients/${CLIENT_ID}/erasure-requests/${REQUEST_ID}/execute`);
  });

  it('offers no button at all to a lead practitioner, who may not carry one out', async () => {
    mount(<ErasureSection record={record} mayAsk mayErase={false} />, {
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
      />,
      { requests: [performedRequest] },
    );
    expect(await screen.findByText(/Erased on 3 September 2026 by Hazel Ridge/)).toBeTruthy();
    // What was asked, and what was said when it was carried out: both stay.
    expect(screen.getByText('Asked on')).toBeTruthy();
    expect(screen.getByText('Iris Creek')).toBeTruthy();
    expect(screen.getByText('Reason given when erasing')).toBeTruthy();

    // Every count, and each of them pluralised.
    expect(screen.getByText('1 contact emptied')).toBeTruthy();
    expect(screen.getByText('1 portal account closed')).toBeTruthy();
    expect(screen.getByText('3 goals cleared')).toBeTruthy();
    expect(screen.getByText('6 visits cleared')).toBeTruthy();
    expect(screen.getByText('40 visit events cleared')).toBeTruthy();
    expect(screen.getByText('1 payment reference cleared')).toBeTruthy();
    expect(screen.getByText('4 documents deleted')).toBeTruthy();
    expect(screen.getByText(/2 invoices and credit notes, as tax law requires/)).toBeTruthy();
    expect(screen.getByText('The measurements, with nobody attached to them')).toBeTruthy();

    expect(screen.getByRole('button', { name: /Download the letter/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft a WhatsApp message' })).toBeTruthy();
    // The letter is named, so it can be found again in a downloads folder.
    expect(screen.getByText(/erasure-letter-MW-000061\.md/)).toBeTruthy();
    expect(screen.getByText(/pending the practice's lawyer/)).toBeTruthy();
  });

  it('names the record it is about, and warns an admin what they lose', async () => {
    mount(<ErasureSection record={record} mayAsk mayErase />, { requests: [openRequest] });
    fireEvent.click(await screen.findByRole('button', { name: 'Erase this client' }));
    const heading = screen.getByText(/This erases record MW-000061\. It cannot be undone\./);
    expect(heading).toBeTruthy();
    // The step takes focus, so a person is inside it rather than left on a
    // button whose meaning has changed.
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/You will no longer be able to open this record/)).toBeTruthy();
    // And it says the same as the letter about what is kept.
    expect(screen.getByText(/The measurements stay, with nobody attached to them/)).toBeTruthy();
    expect(screen.getByText(/Invoices and receipts are kept for five years/)).toBeTruthy();
    expect(screen.getByText(/holding the names of the fields that were cleared/)).toBeTruthy();
  });

  it('hands the number to WhatsApp only when the button is pressed, and never to the page', async () => {
    const open = vi.fn((url: string, target?: string, features?: string) => {
      void target;
      void features;
      void url;
      return {} as Window;
    });
    vi.stubGlobal('open', open);
    mount(<ErasureSection record={{ ...record, status: 'erased' }} mayAsk mayErase />, {
      requests: [performedRequest],
    });
    await screen.findByText(/Erased on 3 September 2026/);
    // Before the press, the number is nowhere in the document.
    expect(document.body.innerHTML).not.toContain('971500000071');

    fireEvent.click(screen.getByRole('button', { name: 'Draft a WhatsApp message' }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]?.[0]);
    expect(url.startsWith('https://wa.me/971500000071?text=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('3 September 2026');
    vi.unstubAllGlobals();
  });

  it('drafts the message in the household’s own language', async () => {
    const open = vi.fn((url: string, target?: string, features?: string) => {
      void target;
      void features;
      void url;
      return {} as Window;
    });
    vi.stubGlobal('open', open);
    mount(
      <ErasureSection
        record={{ ...record, status: 'erased', preferredLocale: 'ar' }}
        mayAsk
        mayErase
      />,
      { requests: [performedRequest] },
    );
    await screen.findByText(/Erased on 3 September 2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Draft a WhatsApp message' }));
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

  it('says so in Contacts, Locations, Goals and Consent, and offers no write action', async () => {
    const erased = { ...record, status: 'erased' as const };
    for (const [node, note] of [
      [
        <ContactsTab
          clientId={CLIENT_ID}
          record={erased}
          onChanged={vi.fn()}
          mayWrite={false}
          erased
        />,
        /the contacts keep their relationship/,
      ],
      [
        <LocationsTab
          clientId={CLIENT_ID}
          record={erased}
          onChanged={vi.fn()}
          mayWrite={false}
          erased
        />,
        /keeps only its emirate/,
      ],
      [
        <GoalsTab
          clientId={CLIENT_ID}
          record={erased}
          onChanged={vi.fn()}
          mayWrite={false}
          erased
        />,
        /kept their category and lost what was written beside them/,
      ],
      [
        <ConsentTab
          clientId={CLIENT_ID}
          record={erased}
          onChanged={vi.fn()}
          mayWrite={false}
          erased
        />,
        /nothing more can be recorded or withdrawn/,
      ],
    ] as const) {
      mount(node);
      expect(await screen.findByText(note)).toBeTruthy();
      // Every one of these tabs offers its write action as a button; none of
      // them offers one to an erased record.
      for (const label of ['Add a contact', 'Add an address', 'Set a goal', 'Record consent']) {
        expect(screen.queryByRole('button', { name: label })).toBeNull();
      }
      cleanup();
    }
  });
});

describe('the drawer, after the act', () => {
  it('keeps the erased panel and asks the server for nothing more', async () => {
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(ADMIN);
      calls.push({ url, init });
      if (url.endsWith('/execute')) {
        return json({
          request: performedRequest,
          letter: { url: 'https://storage.example.com/letter', expiresInSeconds: 300 },
        });
      }
      if (url.endsWith('/erasure-requests')) return json({ requests: [openRequest] });
      if (url === `/api/clients/${CLIENT_ID}`) return json(record);
      if (url.endsWith('/documents')) return json({ documents: [] });
      if (url.includes('/timeline')) return json({ events: [], nextCursor: null });
      return json({ id: CLIENT_ID });
    }) as unknown as typeof fetch;
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ClientDrawer
          client={{
            id: CLIENT_ID,
            mrn: record.mrn,
            givenName: 'Willow',
            familyName: 'Creek',
            givenNameAr: null,
            familyNameAr: null,
            dateOfBirth: record.dateOfBirth,
            status: 'active',
            contactRelationship: 'self',
            contactPhone: '+971500000071',
            emirate: 'DXB',
          }}
          onClose={vi.fn()}
        />
      </AuthProviderBoundary>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Erase this client' }));
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'The household asked.' },
    });
    const before = calls.filter((call) => call.url === `/api/clients/${CLIENT_ID}`).length;
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Erase this client' }).at(-1) as HTMLButtonElement,
    );

    // The panel that did it stays, with the letter on it.
    expect(await screen.findByText(/Erased on 3 September 2026/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download the letter' })).toBeTruthy();
    // An admin may not open an erased record, so nothing asks the server for
    // one: a refetch here would be a 403 and "the record could not be loaded"
    // immediately after an irreversible act succeeded.
    expect(calls.filter((call) => call.url === `/api/clients/${CLIENT_ID}`).length).toBe(before);
    expect(screen.queryByText('The record could not be loaded. Try again.')).toBeNull();
    // And the header says what the record now is.
    expect(screen.getByText('Erased')).toBeTruthy();
  });
});
