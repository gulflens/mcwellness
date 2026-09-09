// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { PracticePage } from './PracticePage';

/**
 * The Practice settings screen: what it shows, what it refuses to send, and
 * what it sends when it does. Inside a MemoryRouter since 8 September 2026:
 * the page carries the strip of links to the other settings screen
 * (SettingsNav.tsx), and a NavLink needs a router around it. Synthetic throughout (.claude/rules/testing.md);
 * the practice's real identity is entered on staging by the operator and is
 * never written into a fixture.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const PRACTICE = {
  legalName: 'Synthetic Wellness Studio',
  // Invented, like everything else here. The console is English only
  // (docs/DESIGN-BRIEF.md section 10 item 4) so this is never shown and never
  // typed — it is here to prove the drawer sends back what it loaded.
  legalNameAr: 'استوديو صناعي للعافية',
  taxRegistrationNumber: '000000000000000',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
  licenceExpiresOn: '2027-12-31',
  vatRegistered: false,
  vatTrn: null,
  // The threshold watch (migration 953): a young practice, well below both
  // marks. AED 42,000 in twelve months.
  vatTaxableSuppliesFils: 4_200_000,
  vatTaxableSuppliesAsOf: '2026-09-06',
  // What the client portal's ask-for-a-visit button opens (migration 910).
  whatsappNumber: null,
  // The three printed in the footer of every document the practice issues
  // (migration 912). This page cannot edit them yet — the round that adds them
  // to the form is docs/CHANGE-REQUESTS/billing-09.md item 6 — but the practice
  // it reads back carries them.
  contactPhone: null,
  contactEmail: null,
  website: null,
  defaultEmirate: 'DXB',
  timezone: 'Asia/Dubai',
  address: {
    displayAddress: 'Unit 1, Synthetic Tower, Dubai',
    emirate: 'DXB',
    latitude: 25.19,
    longitude: 55.26,
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Call = { url: string; init?: RequestInit };

/** A fresh practice has no logo; PracticeLogo.test.tsx covers the section itself. */
const NO_LOGO = () => json({ error: 'not_found', requestId: null }, 404);

/** Answers the read, and whatever the test says to the save. */
function mount(answer: (call: Call) => Response = () => json({ practice: PRACTICE })) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    if (call.url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['admin'],
        capabilities: [],
      });
    }
    if (call.url === '/api/practice' && (init?.method ?? 'GET') === 'GET') {
      return json({ practice: PRACTICE });
    }
    // The logo section asks on mount, and a practice starts without one.
    // What the section itself does is PracticeLogo.test.tsx's; this file is
    // about the identity form, so the answer here is always "no logo yet".
    if (call.url === '/api/practice/logo') {
      return NO_LOGO();
    }
    return answer(call);
  }) as unknown as typeof fetch;

  render(
    <MemoryRouter>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <PracticePage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { calls };
}

const saves = (calls: Call[]) =>
  calls.filter((call) => call.url === '/api/practice' && call.init?.method === 'PATCH');

async function openTheDrawer(): Promise<void> {
  // The button is on the page from the first paint and disabled until the
  // details arrive, so the header does not change height under the reader.
  // Wait for it to mean something before pressing it.
  const button = await screen.findByRole('button', { name: 'Edit details' });
  await waitFor(() => expect(button).toHaveProperty('disabled', false));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Practice details' });
}

function type(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('Practice settings — what it shows', () => {
  it('reads the practice back, and says what the VAT setting does and does not do', async () => {
    mount();
    expect(await screen.findByText('Synthetic Wellness Studio')).toBeTruthy();
    expect(screen.getByText('SYN-000000')).toBeTruthy();
    expect(screen.getByText('31 Dec 2027')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    // The two things this group must not leave a reader to guess: which tax
    // number this is, and that recording a registration charges nothing.
    expect(screen.getByText('Corporate tax registration number')).toBeTruthy();
    expect(screen.getByText(/never printed as a VAT one/)).toBeTruthy();
    expect(screen.getByText(/carry no VAT and show one figure/)).toBeTruthy();
  });

  it('says nothing is recorded rather than showing a gap', async () => {
    const bare = { ...PRACTICE, licenceNumber: null, legalNameAr: null, address: null };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/me'
        ? json({
            userId: '00000002-0000-4000-8000-000000000010',
            displayName: 'Hazel Harbour',
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['admin'],
            capabilities: [],
          })
        : json({ practice: bare }),
    ) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Synthetic Wellness Studio')).toBeTruthy();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(2);
  });
});

describe('Practice settings — the gate', () => {
  it('says whose details these are when the API refuses the read', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/me'
        ? json({
            userId: '00000002-0000-4000-8000-000000000012',
            displayName: 'Priya Nair',
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['finance'],
            capabilities: [],
          })
        : json({ error: 'forbidden', requestId: null }, 403),
    ) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/These details are the owner/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toHaveProperty('disabled', true);
  });

  it('answers a refused save with a sentence, not silence', async () => {
    const { calls } = mount(() => json({ error: 'forbidden', requestId: null }, 403));
    await openTheDrawer();
    type('Why this changes', 'The trade licence was renewed.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(
      await screen.findByText("You don't have permission to change the practice's details."),
    ).toBeTruthy();
    expect(saves(calls)).toHaveLength(1);
  });
});

describe('Practice settings — the save', () => {
  it('sends the whole form with a reason, and says so when it lands', async () => {
    const saved = {
      ...PRACTICE,
      legalName: 'Synthetic Wellness Studio FZ-LLC',
      licenceNumber: 'SYN-000001',
    };
    const { calls } = mount(() => json({ practice: saved }));
    await openTheDrawer();
    type('Legal name', 'Synthetic Wellness Studio FZ-LLC');
    type('Trade licence number (optional)', 'SYN-000001');
    type('Why this changes', 'The licence was reissued under the new legal name.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect(await screen.findByText('The practice details are saved.')).toBeTruthy();
    const [save] = saves(calls);
    expect(new Headers(save?.init?.headers).get('x-reason')).toBe(
      'The licence was reissued under the new legal name.',
    );
    expect(JSON.parse(String(save?.init?.body))).toMatchObject({
      legalName: 'Synthetic Wellness Studio FZ-LLC',
      // The whole form travels at once and legalNameAr is required in the
      // body, so the drawer sends back the value it loaded rather than a
      // blank: a save from this screen may never wipe the Arabic legal name
      // that is printed on the practice's invoices.
      legalNameAr: 'استوديو صناعي للعافية',
      licenceNumber: 'SYN-000001',
      vatRegistered: false,
      address: {
        displayAddress: 'Unit 1, Synthetic Tower, Dubai',
        emirate: 'DXB',
        latitude: 25.19,
        longitude: 55.26,
      },
    });
    // The drawer closes and the page shows what came back, not what was typed.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Synthetic Wellness Studio FZ-LLC')).toBeTruthy();
  });

  it("saves the practice's WhatsApp number, and refuses one that is not a number", async () => {
    const { calls } = mount(() =>
      json({ practice: { ...PRACTICE, whatsappNumber: '+971500000024' } }),
    );
    await openTheDrawer();
    type('WhatsApp number (optional)', 'not a number');
    type('Why this changes', 'The practice number changed.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('A WhatsApp number is +971 50 000 0000.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);

    // The spaces a person types are stripped: the column holds E.164.
    type('WhatsApp number (optional)', '+971 50 000 0024');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(JSON.parse(String(saves(calls)[0]?.init?.body))).toMatchObject({
      whatsappNumber: '+971500000024',
    });
    expect(await screen.findByText('+971500000024')).toBeTruthy();
  });

  it('saves the three contact details printed on documents, and refuses an address without @', async () => {
    const { calls } = mount(() =>
      json({
        practice: {
          ...PRACTICE,
          contactPhone: '+971 4 000 0000',
          contactEmail: 'hello@example.com',
          website: 'https://example.com',
        },
      }),
    );
    await openTheDrawer();
    type('Telephone on documents (optional)', '+971 4 000 0000');
    type('Email on documents (optional)', 'not an address');
    type('Website on documents (optional)', 'https://example.com');
    type('Why this changes', 'The practice contact details are set.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('An email address is name@example.com.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);

    type('Email on documents (optional)', 'hello@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(JSON.parse(String(saves(calls)[0]?.init?.body))).toMatchObject({
      contactPhone: '+971 4 000 0000',
      contactEmail: 'hello@example.com',
      website: 'https://example.com',
    });
    expect(await screen.findByText('hello@example.com')).toBeTruthy();
  });

  it('will not save without a reason, and never reaches the API to find out', async () => {
    const { calls } = mount();
    await openTheDrawer();
    type('Legal name', 'Synthetic Wellness Studio FZ-LLC');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Say why this is changing before saving.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);
  });
});

describe('Practice settings — the address', () => {
  it('refuses coordinates with no address rather than dropping them', async () => {
    // With nothing on record the form used to send address: null, and typed
    // coordinates went nowhere without a word (design review, round 20).
    const bare = { ...PRACTICE, address: null };
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return String(input) === '/api/me'
        ? json({
            userId: '00000002-0000-4000-8000-000000000010',
            displayName: 'Hazel Harbour',
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['admin'],
            capabilities: [],
          })
        : json({ practice: bare });
    }) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );

    await openTheDrawer();
    type('Latitude (optional)', '25.19');
    type('Longitude (optional)', '55.26');
    type('Why this changes', 'Recording where the studio is.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(
      await screen.findByText('Give the address these coordinates belong to, or clear them.'),
    ).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);
  });

  it('asks for the coordinates when the first address is recorded', async () => {
    const bare = { ...PRACTICE, address: null };
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return String(input) === '/api/me'
        ? json({
            userId: '00000002-0000-4000-8000-000000000010',
            displayName: 'Hazel Harbour',
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['admin'],
            capabilities: [],
          })
        : json({ practice: bare });
    }) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );

    await openTheDrawer();
    type('Registered address (optional)', 'Unit 1, Synthetic Tower, Dubai');
    type('Why this changes', 'Recording the studio address.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText(/needs its map coordinates/)).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);
  });
});

describe('Practice settings — the VAT switch', () => {
  it('asks for the number the moment the switch goes on, and sends nothing until it has one', async () => {
    const { calls } = mount();
    await openTheDrawer();
    expect(screen.queryByLabelText('VAT registration number')).toBeNull();

    fireEvent.click(screen.getByLabelText('Registered for VAT'));
    expect(screen.getByLabelText('VAT registration number')).toBeTruthy();
    type('Why this changes', 'The practice crossed the registration threshold.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(
      await screen.findByText(
        'A VAT registration needs the number that will be printed on invoices.',
      ),
    ).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);

    // A number of the wrong length is refused in the same place.
    type('VAT registration number', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('A VAT registration number is 15 digits.')).toBeTruthy();
    expect(saves(calls)).toHaveLength(0);

    type('VAT registration number', '100000000000003');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(JSON.parse(String(saves(calls)[0]?.init?.body))).toMatchObject({
      vatRegistered: true,
      vatTrn: '100000000000003',
    });
  });

  it('says what the switch does, and binds that sentence to the control', async () => {
    mount();
    await openTheDrawer();
    const control = screen.getByLabelText('Registered for VAT');
    const described = control.getAttribute('aria-describedby');
    expect(described).toBe('practice-vat-consequence');
    const sentence = document.getElementById(described ?? '');
    // The three things a person needs before touching it: what it records,
    // what it decides, and what turning it off costs them. Since migration
    // 406 the switch decides whether an invoice carries VAT at all, so the
    // sentence that said it changed nothing is gone
    // (docs/CHANGE-REQUESTS/billing-07.md).
    expect(sentence?.textContent).toContain('records the registration');
    expect(sentence?.textContent).toContain('invoices carry no VAT and show one figure');
    expect(sentence?.textContent).toContain('removes the number from the record');
    expect(sentence?.textContent).not.toContain('does not change what an invoice charges');
  });

  it('drops the number when the switch goes off, so nothing is printed as a VAT number', async () => {
    const registered = { ...PRACTICE, vatRegistered: true, vatTrn: '100000000000003' };
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), init };
      calls.push(call);
      if (call.url === '/api/me') {
        return json({
          userId: '00000002-0000-4000-8000-000000000010',
          displayName: 'Hazel Harbour',
          tenantId: '00000001-0000-4000-8000-000000000001',
          roles: ['admin'],
          capabilities: [],
        });
      }
      if ((init?.method ?? 'GET') === 'GET') {
        return json({ practice: registered });
      }
      return json({ practice: { ...registered, vatRegistered: false, vatTrn: null } });
    }) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );

    await openTheDrawer();
    fireEvent.click(screen.getByLabelText('Registered for VAT'));
    type('Why this changes', 'The registration was cancelled by the authority.');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(JSON.parse(String(saves(calls)[0]?.init?.body))).toMatchObject({
      vatRegistered: false,
      vatTrn: '',
    });
  });
});

describe('Practice settings — the VAT threshold watch', () => {
  /** The screen with a practice of this shape, and nothing else moved. */
  function mountPractice(practice: Record<string, unknown>) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') {
        return json({
          userId: '00000002-0000-4000-8000-000000000010',
          displayName: 'Hazel Harbour',
          tenantId: '00000001-0000-4000-8000-000000000001',
          roles: ['admin'],
          capabilities: [],
        });
      }
      if (url === '/api/practice/logo') return NO_LOGO();
      return json({ practice });
    }) as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <PracticePage />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
  }

  it('shows the figure and both marks, and says nothing more while it is below them', async () => {
    mountPractice(PRACTICE);
    expect(await screen.findByText('Taxable supplies, last twelve months (AED)')).toBeTruthy();
    expect(screen.getByText('42,000.00')).toBeTruthy();
    expect(screen.getByText('187,500.00')).toBeTruthy();
    expect(screen.getByText('375,000.00')).toBeTruthy();
    expect(screen.queryByText(/duty within thirty days/)).toBeNull();
  });

  it('says nothing new past the first mark, which changes nothing the practice must do', async () => {
    // The mark is on the page; passing it is not a notice. The plan asks for
    // the duty sentence past the second mark and no more.
    mountPractice({ ...PRACTICE, vatTaxableSuppliesFils: 18_750_000 });
    // The figure has reached the mark, so both cells read the same.
    expect(await screen.findAllByText('187,500.00')).toHaveLength(2);
    expect(screen.queryByText(/duty within thirty days/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says registering has become a duty past the second, on every visit', async () => {
    mountPractice({ ...PRACTICE, vatTaxableSuppliesFils: 41_000_000 });
    const notice = await screen.findByText(/duty within thirty days/);
    expect(notice).toBeTruthy();
    // Said loudly enough that a screen reader announces it without being asked.
    expect(notice.getAttribute('role')).toBe('alert');
    // The duty and nothing after it: where to apply is the paragraph above's.
    expect(notice.textContent).not.toContain('Apply to the Federal Tax Authority');
  });

  it('stops saying it once the practice has registered', async () => {
    mountPractice({
      ...PRACTICE,
      vatTaxableSuppliesFils: 41_000_000,
      vatRegistered: true,
      vatTrn: '100000000000003',
    });
    expect(await screen.findByText('410,000.00')).toBeTruthy();
    expect(screen.queryByText(/duty within thirty days/)).toBeNull();
  });
});
