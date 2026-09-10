// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import {
  RecordConsentBundleBody,
  type ClientRecordResponse,
} from '../../api/clients/record-schema';
import { SignAllForm } from './SignAllForm';
import { ADMIN, signedInProvider } from './testActors';

/**
 * "Sign everything at once" (trunk round 43, part four): the wordings every
 * required purpose is stacked and read together, the pad unlocks once the
 * whole stack has been scrolled to its end, and one signature files one
 * bundle. Modelled on ConsentCapture.test.tsx's mount helper and canvas
 * stub, extended for the wording route answering per purpose and for the
 * bundle route this form posts to instead of the single-consent one.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ADULT_CLIENT_ID = '00000009-0000-4000-8000-000000000401';
const ADULT_SELF_CONTACT_ID = '00000009-0000-4000-8000-000000000402';
const CHILD_CLIENT_ID = '00000009-0000-4000-8000-000000000410';
const GUARDIAN_CONTACT_ID = '00000009-0000-4000-8000-000000000411';
const SIBLING_CONTACT_ID = '00000009-0000-4000-8000-000000000412';

const WORDING_IDS: Record<string, string> = {
  participation: '00000009-0000-4000-8000-000000000501',
  minor_participation: '00000009-0000-4000-8000-000000000502',
  home_visit: '00000009-0000-4000-8000-000000000503',
  health_data: '00000009-0000-4000-8000-000000000504',
};

const WORDING_MARKDOWN = [
  '---',
  'purpose: participation',
  'locale: en',
  'version: 0.1-draft',
  'status: draft',
  '---',
  '',
  '# Agreement',
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

function wordingFor(purpose: string) {
  return {
    id: WORDING_IDS[purpose] ?? WORDING_IDS.participation,
    purpose,
    locale: 'en',
    version: '0.1-draft',
    status: 'draft',
    mimeType: 'text/markdown',
    textUrl: `/api/storage/wording-${purpose}?expires=1&token=x`,
    expiresInSeconds: 300,
  };
}

const adultRecord: ClientRecordResponse = {
  id: ADULT_CLIENT_ID,
  mrn: 'MW-000401',
  givenName: 'Basil',
  familyName: 'Cliff',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '1990-01-01',
  sexAtBirth: 'male',
  preferredLocale: 'en',
  referralSource: null,
  status: 'lead',
  contacts: [
    {
      id: ADULT_SELF_CONTACT_ID,
      givenName: 'Basil',
      familyName: 'Cliff',
      givenNameAr: null,
      familyNameAr: null,
      relationship: 'self',
      isLegalGuardian: false,
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000041',
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
  ],
  locations: [],
  consents: [],
  goals: [],
};

const childRecord: ClientRecordResponse = {
  id: CHILD_CLIENT_ID,
  mrn: 'MW-000410',
  givenName: 'Dahlia',
  familyName: 'Meadow',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '2015-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: null,
  status: 'lead',
  contacts: [
    {
      id: GUARDIAN_CONTACT_ID,
      givenName: 'Ember',
      familyName: 'Dune',
      givenNameAr: null,
      familyNameAr: null,
      relationship: 'mother',
      isLegalGuardian: true,
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000043',
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
    // Can consent, but is not a legal guardian: proves the stack's own
    // minor_participation purpose narrows "Given by" to guardians only,
    // rather than to anyone the practice has marked as able to consent.
    {
      id: SIBLING_CONTACT_ID,
      givenName: 'Jasper',
      familyName: 'Dune',
      givenNameAr: null,
      familyNameAr: null,
      relationship: 'other',
      isLegalGuardian: false,
      canConsent: true,
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

function mount(
  node: React.ReactNode,
  options: { calls?: Call[]; me?: unknown; bundleResponse?: Response } = {},
) {
  const calls = options.calls ?? [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/me') return json(options.me ?? ADMIN);
    if (url.startsWith('/api/clients/consent-wording')) {
      const purpose =
        new URL(url, 'http://localhost').searchParams.get('purpose') ?? 'participation';
      return json(wordingFor(purpose));
    }
    if (url.startsWith('/api/storage/')) {
      return new Response(WORDING_MARKDOWN, { status: 200 });
    }
    if (url.endsWith('/consents/bundle') && init?.method === 'POST') {
      return (
        options.bundleResponse ?? json({ ids: ['a', 'b', 'c'], signatureDocumentId: 'd' }, 201)
      );
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      {node}
    </AuthProviderBoundary>,
  );
  return calls;
}

/** The pad needs a canvas; without one it says so (SignaturePad.test.tsx covers that). */
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
        // The stack's caption is always more than a few words (every client
        // needs at least three purposes' worth), so SignaturePad always
        // measures it to decide how to wrap it (SignaturePad.tsx).
        measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
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

/**
 * jsdom reports every height as zero, so the stacked wording box always
 * looks already scrolled to the end unless the two heights are stubbed
 * (ConsentCapture.test.tsx's own gate test does the same, for the same
 * reason): stubbing before mount is what makes the gate closed at all.
 */
function stubHeights(scrollHeight: number, clientHeight: number): void {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

function draw(pad: Element | null): void {
  fireEvent.pointerDown(pad as Element, { clientX: 40, clientY: 60, pointerId: 1 });
  fireEvent.pointerMove(pad as Element, { clientX: 120, clientY: 80, pointerId: 1 });
  fireEvent.pointerUp(pad as Element, { clientX: 120, clientY: 80, pointerId: 1 });
}

describe('SignAllForm', () => {
  beforeEach(stubCanvas);

  it('stacks every wording the client needs, gates the pad on the end, and sends one bundle', async () => {
    stubHeights(1800, 500);
    const calls: Call[] = [];
    const onSaved = vi.fn();
    mount(
      <SignAllForm
        clientId={ADULT_CLIENT_ID}
        record={adultRecord}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
      {
        calls,
      },
    );

    expect(await screen.findByRole('heading', { name: 'Participation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Visits at home' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Brain-map and neurofeedback information' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "Guardian's consent for a child" })).toBeNull();
    expect(screen.getByText('Scroll to the end of the wording before signing.')).toBeTruthy();

    fireEvent.scroll(screen.getByRole('region', { name: 'Consent wording' }), {
      target: { scrollTop: 1300 },
    });
    await waitFor(() => {
      expect(document.querySelector('canvas')?.getAttribute('aria-disabled')).toBeNull();
    });
    expect(screen.queryByText('Scroll to the end of the wording before signing.')).toBeNull();

    draw(document.querySelector('canvas'));
    fireEvent.change(screen.getByLabelText('Name, as the person writes it'), {
      target: { value: 'Basil Cliff' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record all three consents' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(['health_data', 'home_visit', 'participation']);

    const post = calls.find((c) => c.url.endsWith('/consents/bundle'));
    expect(post).toBeDefined();
    const body = JSON.parse(String(post?.init?.body)) as {
      purposes: { purpose: string; textDocumentId: string }[];
      givenByContactId: string;
      method: string;
      evidence: { mimeType: string; bytesBase64: string };
    };
    expect(body.purposes.map((p) => p.purpose).sort()).toEqual([
      'health_data',
      'home_visit',
      'participation',
    ]);
    expect(body.givenByContactId).toBe(ADULT_SELF_CONTACT_ID);
    expect(body.method).toBe('app_signature');
    expect(body.evidence.mimeType).toBe('image/png');
    expect(RecordConsentBundleBody.safeParse(body).success).toBe(true);
  });

  it('asks for the guardian’s consent too when the client is a child, and only a guardian may sign', async () => {
    mount(
      <SignAllForm
        clientId={CHILD_CLIENT_ID}
        record={childRecord}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: "Guardian's consent for a child" }),
    ).toBeTruthy();
    const giver = screen.getByLabelText('Given by') as HTMLSelectElement;
    expect([...giver.options].map((option) => option.textContent)).toEqual([
      'Ember Dune — mother (legal guardian)',
    ]);
  });

  it('files the caption in the headings’ own words for a household with a child, not the old short ones', async () => {
    stubHeights(1800, 500);
    // A shared context, captured, rather than `stubCanvas`'s fresh object
    // per call: the filed image is a second canvas composed inside
    // `SignaturePad.tsx`, and this is the only way to read back what it drew.
    const texts: string[] = [];
    const capturingContext = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn((text: string) => {
        texts.push(text);
      }),
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => capturingContext as never,
    );

    mount(
      <SignAllForm
        clientId={CHILD_CLIENT_ID}
        record={childRecord}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { name: "Guardian's consent for a child" });
    fireEvent.scroll(screen.getByRole('region', { name: 'Consent wording' }), {
      target: { scrollTop: 1300 },
    });
    await waitFor(() => {
      expect(document.querySelector('canvas')?.getAttribute('aria-disabled')).toBeNull();
    });
    draw(document.querySelector('canvas'));

    // The old short words this evidence used to print — "health data" and
    // "guardian consent" — never appear now.
    expect(texts.join(' ')).not.toContain('health data');
    expect(texts.join(' ')).not.toContain('guardian consent');
    // The four purposes are named in the exact words their headings on
    // screen just used, wrapped across the lines they need.
    expect(texts).toContain('Signed for: Brain-map and neurofeedback information,');
    expect(texts).toContain("Visits at home, Guardian's consent for a child,");
    expect(texts).toContain('Participation');
  });

  it('names the refusal when one wording has moved on', async () => {
    mount(
      <SignAllForm
        clientId={ADULT_CLIENT_ID}
        record={adultRecord}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
      {
        bundleResponse: json({ error: 'bad_request', code: 'wording_superseded' }, 400),
      },
    );
    await screen.findByRole('heading', { name: 'Participation' });
    draw(document.querySelector('canvas'));
    fireEvent.change(screen.getByLabelText('Name, as the person writes it'), {
      target: { value: 'Basil Cliff' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record all three consents' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/newer version/);
  });
});
