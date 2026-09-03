// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { ConsentTab } from './ConsentTab';
import { DocumentsTab } from './DocumentsTab';
import { ADMIN, PRACTITIONER, signedInProvider } from './testActors';

/**
 * Recording a consent and filing a document, from the screens
 * (docs/SPEC/client-record.md sections 4.2 and 7).
 *
 * The wording, the draft line, the read-to-the-end gate and the refusals each
 * have a test, because each is a rule rather than a decoration: a consent
 * records that a person was shown a text, and every one of these is part of
 * what "shown" means.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CLIENT_ID = '00000008-0000-4000-8000-000000000201';
const GUARDIAN_ID = '00000008-0000-4000-8000-000000000202';
const SIBLING_ID = '00000008-0000-4000-8000-000000000203';
const WORDING_ID = '00000008-0000-4000-8000-000000000204';
const EVIDENCE_ID = '00000008-0000-4000-8000-000000000205';
const WITNESS_ID = '00000008-0000-4000-8000-000000000208';

/** A consent already on the record, so a test can say what has been agreed before. */
function consentOn(purpose: 'participation' | 'home_visit', id: string) {
  return {
    id,
    purpose,
    status: 'active' as const,
    givenByContactId: GUARDIAN_ID,
    givenAt: '2026-09-01T08:00:00+04:00',
    withdrawnAt: null,
    expiresAt: null,
    method: 'app_signature' as const,
    signatureDocumentId: null,
    textDocumentId: WORDING_ID,
    wordingVersion: '0.1-draft',
    wordingStatus: 'draft' as const,
    witnessedByUserId: null,
    witnessedByName: null,
    withdrawalReason: null,
  };
}

const WORDING_MARKDOWN = [
  '---',
  'purpose: participation',
  'locale: en',
  'version: 0.1-draft',
  'status: draft',
  '---',
  '',
  '# Agreement to take part',
  '',
  '**Draft wording, in use until the practice’s lawyer approves a final version.**',
  '',
  '- We will not diagnose or treat anything.',
  '- You may stop at any time.',
].join('\n');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record: ClientRecordResponse = {
  id: CLIENT_ID,
  mrn: 'MW-000201',
  givenName: 'Juniper',
  familyName: 'Harbour',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '2015-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: null,
  status: 'lead',
  contacts: [
    {
      id: GUARDIAN_ID,
      givenName: 'Iris',
      familyName: 'Harbour',
      givenNameAr: 'سوسن',
      familyNameAr: 'مرفأ',
      relationship: 'mother',
      isLegalGuardian: true,
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000021',
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
    {
      id: SIBLING_ID,
      givenName: 'Cedar',
      familyName: 'Harbour',
      givenNameAr: null,
      familyNameAr: null,
      relationship: 'other',
      isLegalGuardian: false,
      canConsent: false,
      canReceiveReports: false,
      canPay: false,
      phone: null,
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
  ],
  locations: [],
  consents: [],
  goals: [],
};

type Call = { url: string; init?: RequestInit };

/** The API and the store, both stubbed: `textUrl` is fetched with plain fetch. */
function mount(
  node: React.ReactNode,
  options: {
    calls?: Call[];
    wording?: unknown;
    wordingStatus?: number;
    consentResponse?: Response;
    documents?: unknown;
    witnesses?: unknown;
    me?: unknown;
  } = {},
) {
  const calls = options.calls ?? [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/me') return json(options.me ?? ADMIN);
    if (url.startsWith('/api/clients/consent-wording')) {
      if (options.wordingStatus && options.wordingStatus !== 200) {
        return json({ error: 'not_found' }, options.wordingStatus);
      }
      return json(
        options.wording ?? {
          id: WORDING_ID,
          purpose: 'participation',
          locale: 'en',
          version: '0.1-draft',
          status: 'draft',
          mimeType: 'text/markdown',
          textUrl: '/api/storage/wording?expires=1&token=x',
          expiresInSeconds: 300,
        },
      );
    }
    if (url.startsWith('/api/storage/')) {
      return new Response(WORDING_MARKDOWN, { status: 200 });
    }
    if (url === '/api/clients/consent-witnesses') {
      return json(options.witnesses ?? { witnesses: [{ id: WITNESS_ID, name: 'Fern Summit' }] });
    }
    if (url.endsWith('/consents') && init?.method === 'POST') {
      return options.consentResponse ?? json({ id: 'x' }, 201);
    }
    if (url.endsWith('/documents') && init?.method !== 'POST') {
      return json(options.documents ?? { documents: [] });
    }
    if (url.endsWith('/documents')) return json({ id: EVIDENCE_ID }, 201);
    if (url.endsWith('/link')) {
      return json({ url: 'https://example.test/signed', expiresInSeconds: 300 });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  // The wording text is fetched with the browser's own fetch, not apiFetch:
  // the signature in the link is its authorisation.
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      {node}
    </AuthProviderBoundary>,
  );
  return calls;
}

describe('ConsentTab', () => {
  it('lists every purpose, with what activation needs first', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    const purposes = await screen.findAllByText(
      /^(Participation|Guardian's consent for a child|Visits at home|Photographs and video)$/,
    );
    // A child, delivered at home: three required, and the first three listed.
    expect(purposes.slice(0, 3).map((node) => node.textContent)).toEqual([
      'Participation',
      "Guardian's consent for a child",
      'Visits at home',
    ]);
  });

  it('offers no recording and no withdrawal to a role the routes would refuse', async () => {
    mount(
      <ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite={false} />,
      { me: PRACTITIONER },
    );
    await screen.findByText('Participation');
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });

  it('names the person who gave a consent, not only their relationship', async () => {
    const signed: ClientRecordResponse = {
      ...record,
      consents: [
        {
          id: '00000008-0000-4000-8000-000000000206',
          purpose: 'participation',
          status: 'active',
          givenByContactId: GUARDIAN_ID,
          givenAt: '2026-09-01T08:00:00+04:00',
          withdrawnAt: null,
          expiresAt: null,
          method: 'app_signature',
          signatureDocumentId: EVIDENCE_ID,
          textDocumentId: WORDING_ID,
          wordingVersion: '0.1-draft',
          wordingStatus: 'draft',
          witnessedByUserId: null,
          witnessedByName: null,
          withdrawalReason: null,
        },
      ],
    };
    mount(<ConsentTab clientId={CLIENT_ID} record={signed} onChanged={vi.fn()} mayWrite />);
    // CR-07's whole point: "Given by: Mother" is not an identification.
    expect(await screen.findByText('Given by Iris Harbour (mother)')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open what was signed, opens in a new tab' }),
    ).toBeTruthy();
    // The words as well as the signature, at the exact version signed.
    expect(
      screen.getByRole('button', { name: 'Wording version 0.1-draft, opens in a new tab' }),
    ).toBeTruthy();
  });

  it('asks for a reason before it will withdraw, and says what it does not do', async () => {
    const signed: ClientRecordResponse = {
      ...record,
      consents: [
        {
          id: '00000008-0000-4000-8000-000000000207',
          purpose: 'participation',
          status: 'active',
          givenByContactId: GUARDIAN_ID,
          givenAt: '2026-09-01T08:00:00+04:00',
          withdrawnAt: null,
          expiresAt: null,
          method: 'app_signature',
          signatureDocumentId: null,
          textDocumentId: WORDING_ID,
          wordingVersion: '0.1-draft',
          wordingStatus: 'draft',
          witnessedByUserId: null,
          witnessedByName: null,
          withdrawalReason: null,
        },
      ],
    };
    const calls = mount(
      <ConsentTab clientId={CLIENT_ID} record={signed} onChanged={vi.fn()} mayWrite />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    expect(
      screen.getByText(/Appointments already in the diary are not cancelled by this/),
    ).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Withdraw consent' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'The household asked us to stop.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
    await waitFor(() => {
      const withdrawal = calls.find((call) => call.url.endsWith('/withdraw'));
      expect(withdrawal).toBeDefined();
      expect(new Headers(withdrawal?.init?.headers).get('x-reason')).toBe(
        'The household asked us to stop.',
      );
    });
  });
});

/** The pad needs a canvas; without one it says so, which is its own test. */
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
      }) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,iVBORw0KGgo=',
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 260,
    width: 600,
    height: 260,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('recording a consent', () => {
  beforeEach(stubCanvas);

  it('shows the wording, its version and its draft line, and fills the name in', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);

    expect(await screen.findByText('Agreement to take part')).toBeTruthy();
    expect(screen.getByText('0.1-draft')).toBeTruthy();
    expect(
      screen.getByText(
        /This wording is a draft, in use until the practice’s lawyer approves a final version/,
      ),
    ).toBeTruthy();
    // The typed name starts from the contact's own (CR-07), and the giver is
    // the only contact who may consent.
    expect((screen.getByLabelText('Name, as the person writes it') as HTMLInputElement).value).toBe(
      'Iris Harbour',
    );
  });

  it('sends the wording that was shown, the method and the drawn signature', async () => {
    const calls = mount(
      <ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    await screen.findByText('Agreement to take part');

    const pad = document.querySelector('canvas');
    fireEvent.pointerDown(pad as Element, { clientX: 40, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(pad as Element, { clientX: 120, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(pad as Element, { clientX: 120, clientY: 80, pointerId: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await waitFor(() => {
      const post = calls.find(
        (call) => call.url.endsWith('/consents') && call.init?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.init?.body)) as {
        textDocumentId: string;
        method: string;
        givenByContactId: string;
        evidence: { mimeType: string; bytesBase64: string };
      };
      // The exact version shown, not a guess and not a purpose name.
      expect(body.textDocumentId).toBe(WORDING_ID);
      expect(body.method).toBe('app_signature');
      expect(body.givenByContactId).toBe(GUARDIAN_ID);
      expect(body.evidence.mimeType).toBe('image/png');
      expect(body.evidence.bytesBase64).toBe('iVBORw0KGgo=');
    });
  });

  it('will not record until something is actually signed', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    await screen.findByText('Agreement to take part');
    // A name is typed and nothing is drawn: not a signature.
    fireEvent.change(screen.getByLabelText('Name, as the person writes it'), {
      target: { value: 'Iris Harbour' },
    });
    expect(
      (screen.getByRole('button', { name: 'Record consent' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says plainly when the practice has published no wording to sign', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />, {
      wordingStatus: 404,
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    expect(
      await screen.findByText(
        /The practice has no wording on file for this consent in this client’s language/,
      ),
    ).toBeTruthy();
  });

  it("turns the route's refusal into a sentence that says what to do", async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />, {
      consentResponse: json({ error: 'bad_request', code: 'guardian_required' }, 400),
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    await screen.findByText('Agreement to take part');
    const pad = document.querySelector('canvas');
    fireEvent.pointerDown(pad as Element, { clientX: 40, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(pad as Element, { clientX: 40, clientY: 60, pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));

    expect(
      await screen.findByText(/A child’s consent has to come from a legal guardian/),
    ).toBeTruthy();
  });
});

describe('the read-to-the-end gate', () => {
  beforeEach(stubCanvas);

  /**
   * jsdom reports every height as zero, so the wording box always looks
   * already scrolled to the end and the gate opened on mount in every test in
   * this file — which is to say it was asserted nowhere. Stubbing the two
   * heights is what makes the rule testable at all.
   */
  function stubHeights(scrollHeight: number, clientHeight: number): void {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
  }

  it('keeps the pad shut until the wording has been read to the end', async () => {
    stubHeights(2000, 300);
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    await screen.findByText('Agreement to take part');

    // A consent records that a person was shown a text, and a text nobody
    // reached the bottom of was not shown.
    const pad = document.querySelector('canvas');
    expect(pad?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Read to the end of the wording to sign.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Record consent' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const box = document.querySelector('.consent-text');
    fireEvent.scroll(box as Element, { target: { scrollTop: 1700 } });

    await waitFor(() => {
      expect(document.querySelector('canvas')?.getAttribute('aria-disabled')).toBeNull();
    });
    expect(screen.queryByText('Read to the end of the wording to sign.')).toBeNull();
  });
});

describe('where a panel opens, and what it says', () => {
  it('puts the reader inside the form the button opened', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[0] as Element);
    // The button that was pressed does not change, and the form used to open
    // below six rows of purposes: focus is the only thing that says it arrived.
    const heading = await screen.findByRole('heading', { name: 'Record participation' });
    expect(document.activeElement).toBe(heading);
  });

  it('names the consent it is about to withdraw, and takes focus to it', async () => {
    const signed: ClientRecordResponse = {
      ...record,
      consents: [consentOn('participation', '00000008-0000-4000-8000-000000000209')],
    };
    mount(<ConsentTab clientId={CLIENT_ID} record={signed} onChanged={vi.fn()} mayWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const heading = await screen.findByRole('heading', {
      name: 'Withdraw consent: participation',
    });
    expect(document.activeElement).toBe(heading);
  });

  it('shows back the reason a consent was withdrawn', async () => {
    const withdrawn: ClientRecordResponse = {
      ...record,
      consents: [
        {
          ...consentOn('participation', '00000008-0000-4000-8000-00000000020a'),
          status: 'withdrawn',
          withdrawnAt: '2026-09-02T08:00:00+04:00',
          withdrawalReason: 'The household asked us to stop.',
        },
      ],
    };
    mount(<ConsentTab clientId={CLIENT_ID} record={withdrawn} onChanged={vi.fn()} mayWrite />);
    expect(await screen.findByText('Reason: The household asked us to stop.')).toBeTruthy();
  });
});

describe('a verbal re-confirmation', () => {
  it('is not offered until there is a home visit to re-confirm', async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    // The third row is home visits, and this client has agreed to nothing.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record' }))[2] as Element);
    await screen.findByText('Agreement to take part');
    expect(screen.queryByRole('option', { name: 'Confirmed verbally, witnessed' })).toBeNull();
  });

  it('asks who heard it, and sends them with the consent', async () => {
    const agreed: ClientRecordResponse = {
      ...record,
      consents: [consentOn('home_visit', '00000008-0000-4000-8000-00000000020b')],
    };
    const calls = mount(
      <ConsentTab clientId={CLIENT_ID} record={agreed} onChanged={vi.fn()} mayWrite />,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Record again' }))[0] as Element);
    await screen.findByText('Agreement to take part');

    fireEvent.change(screen.getByLabelText('How it is being given'), {
      target: { value: 'verbal_witnessed' },
    });
    // Nobody chosen yet: this method files no document, so the witness is the
    // whole of the evidence and the form will not go without one.
    const record_ = await screen.findByLabelText('Witnessed by');
    expect(
      (screen.getByRole('button', { name: 'Record consent' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(record_, { target: { value: WITNESS_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Record consent' }));

    await waitFor(() => {
      const post = calls.find(
        (call) => call.url.endsWith('/consents') && call.init?.method === 'POST',
      );
      const body = JSON.parse(String(post?.init?.body)) as {
        method: string;
        witnessedByUserId: string;
        evidence?: unknown;
      };
      expect(body.method).toBe('verbal_witnessed');
      expect(body.witnessedByUserId).toBe(WITNESS_ID);
      expect(body.evidence).toBeUndefined();
    });
  });
});

describe('DocumentsTab', () => {
  it('lists what is held, with who filed it and how long it is kept', async () => {
    mount(<DocumentsTab clientId={CLIENT_ID} mayWrite />, {
      documents: {
        documents: [
          {
            id: EVIDENCE_ID,
            kind: 'consent_signature',
            mimeType: 'image/png',
            uploadedAt: '2026-09-01T08:00:00.000Z',
            uploadedByName: 'Hazel Harbour',
            retentionUntil: '2031-09-01T08:00:00.000Z',
            isImmutable: true,
            bytesRemoved: false,
          },
        ],
      },
    });
    expect(await screen.findByText('Signed consent')).toBeTruthy();
    expect(screen.getByText('Filed by Hazel Harbour')).toBeTruthy();
    expect(screen.getByText('Unchangeable')).toBeTruthy();
    expect(screen.getByText('01/09/2031')).toBeTruthy();
    // Four columns, not five: the fifth pushed Open off the edge of a 480px
    // drawer, and reaching it took the client's name out of frame. Who filed
    // it folds under what it is, and the table scrolls inside its own box.
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.queryByRole('columnheader', { name: 'Filed by' })).toBeNull();
    expect(screen.getByRole('table').parentElement?.className).toContain('ledger__scroll');
    // Erasure is its own thing, with a reason and a record of what went.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('confirms a filing out loud, and forgets the file it filed', async () => {
    mount(<DocumentsTab clientId={CLIENT_ID} mayWrite />);
    await screen.findByText('Nothing filed against this client yet.');
    const input = document.querySelector('#document-file') as HTMLInputElement;
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'referral.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await screen.findByText('Ready to file: referral.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'File document' }));
    // A row appearing in a table is not a confirmation to somebody who cannot
    // see it appear, and the input went on naming a file already filed.
    const said = await screen.findByText('Referral letter filed.');
    expect(said.getAttribute('role')).toBe('status');
    expect(screen.queryByText('Ready to file: referral.pdf')).toBeNull();
  });

  it('warns against an identity document before anything is chosen', async () => {
    mount(<DocumentsTab clientId={CLIENT_ID} mayWrite />);
    expect(
      await screen.findByText(
        /Never a picture of an Emirates ID, a passport or a visa: the practice does not hold those/,
      ),
    ).toBeTruthy();
  });

  it('shows a reader the list and no way to file anything', async () => {
    mount(<DocumentsTab clientId={CLIENT_ID} mayWrite={false} />, { me: PRACTITIONER });
    expect(await screen.findByText('Nothing filed against this client yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'File document' })).toBeNull();
  });
});
