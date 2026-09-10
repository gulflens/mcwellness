// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/types';
import { App } from './App';

afterEach(cleanup);

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md).
const TENANT_ID = '00000001-0000-4000-8000-000000000001';

const PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: TENANT_ID,
  roles: ['practitioner'],
  capabilities: [],
};

const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000011',
  displayName: 'Sage Harbour',
  tenantId: TENANT_ID,
  roles: ['lead_practitioner'],
  capabilities: [],
};

const ADMIN = {
  userId: '00000002-0000-4000-8000-000000000010',
  displayName: 'Hazel Harbour',
  tenantId: TENANT_ID,
  roles: ['admin'],
  capabilities: [],
};

const OWNER = {
  userId: '00000002-0000-4000-8000-000000000013',
  displayName: 'Cedar Orchard',
  tenantId: TENANT_ID,
  roles: ['owner'],
  capabilities: [],
};

const FINANCE = {
  userId: '00000002-0000-4000-8000-000000000012',
  displayName: 'Iris Valley',
  tenantId: TENANT_ID,
  roles: ['finance'],
  capabilities: [],
};

const CLIENT_CONTACT = {
  userId: '00000002-0000-4000-8000-000000000014',
  displayName: 'Wren Fairview',
  tenantId: TENANT_ID,
  roles: ['client_contact'],
  capabilities: [],
};

/** What GET /api/practice answers on this synthetic practice. */
const PRACTICE = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: null,
  taxRegistrationNumber: null,
  licenceNumber: null,
  licensingAuthority: null,
  licenceExpiresOn: null,
  vatRegistered: false,
  vatTrn: null,
  // The VAT threshold watch (migration 953): well below both marks.
  vatTaxableSuppliesFils: 4_200_000,
  vatTaxableSuppliesAsOf: '2026-09-06',
  // What the client portal's ask-for-a-visit button opens (migration 910).
  whatsappNumber: null,
  // The three printed in the footer of every document the practice issues
  // (migration 912), which this screen cannot yet edit.
  contactPhone: null,
  contactEmail: null,
  website: null,
  defaultEmirate: 'DXB',
  timezone: 'Asia/Dubai',
  address: null,
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

/** No token, so the session settles on signed-out without a request. */
const signedOutProvider: AuthProvider = { ...provider, getAccessToken: async () => null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(me: unknown, path = '/today/check-in', auth: AuthProvider = provider) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url === '/api/sessions/service-types') return json({ serviceTypes: [] });
    if (url.startsWith('/api/clients')) return json({ clients: [], note: null });
    if (url === '/api/billing/prices') return json({ prices: [], vatRegistered: false });
    if (url === '/api/practice') return json({ practice: PRACTICE });
    if (url === '/api/practitioners') return json({ practitioners: [], scope: null });
    if (url.startsWith('/api/routing/practice-day')) return json({ practitioners: [] });
    if (url.startsWith('/api/appointments/board')) {
      // The day the board asked for, with nobody on the practice's books:
      // enough for the route guard, which is what these cases are about.
      const date = new URL(url, 'http://localhost').searchParams.get('date');
      return json({ date, latenessAvailable: false, practitioners: [] });
    }
    if (url.startsWith('/api/appointments')) return json({ appointments: [] });
    return json({ error: 'not_found', requestId: null }, 404);
  }) as unknown as typeof fetch;

  return render(
    <AuthProviderBoundary provider={auth} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('App — /today/check-in', () => {
  it('lets a practitioner reach the check-in screen', async () => {
    mount(PRACTITIONER);
    expect(await screen.findByRole('heading', { name: 'Check in' })).toBeTruthy();
  });

  it('lets a lead practitioner reach the check-in screen', async () => {
    mount(LEAD_PRACTITIONER);
    expect(await screen.findByRole('heading', { name: 'Check in' })).toBeTruthy();
  });

  it('sends an admin-only account to their own desk instead', async () => {
    mount(ADMIN);
    // Landed on the admin console (Clients), never the check-in screen.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Check in' })).toBeNull();
  });
});

describe('App — /admin/billing and /admin/schedule', () => {
  it('lets an admin reach the price list', async () => {
    mount(ADMIN, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeTruthy();
  });

  it('lets an admin reach the day schedule', async () => {
    mount(ADMIN, '/admin/schedule');
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeTruthy();
  });

  it('lets an admin reach the week, behind the same rule as the day', async () => {
    mount(ADMIN, '/admin/schedule/week');
    expect(await screen.findByRole('heading', { name: 'Week' })).toBeTruthy();
  });

  it('sends a practitioner home instead of the week', async () => {
    mount(PRACTITIONER, '/admin/schedule/week');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Week' })).toBeNull();
  });

  it("lets an admin reach the dispatcher's board", async () => {
    mount(ADMIN, '/admin/schedule/board');
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
  });

  it('lets a lead practitioner reach the board', async () => {
    mount(LEAD_PRACTITIONER, '/admin/schedule/board');
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
  });

  it('sends a practitioner home instead of the board', async () => {
    // appointment.board.read is the three calendar roles' (docs/SPEC/dispatch.md
    // section 3): a practitioner sees their own day on Today, never the
    // practice's board.
    mount(PRACTITIONER, '/admin/schedule/board');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
  });

  it('sends finance to their own desk instead of the board', async () => {
    mount(FINANCE, '/admin/schedule/board');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
  });

  it("shows the rail's Billing and Schedule links for an admin", async () => {
    mount(ADMIN, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/schedule'),
    );
  });

  it('sends a practitioner home instead of the price list', async () => {
    mount(PRACTITIONER, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Billing' })).toBeNull();
  });

  it('sends a practitioner home instead of the day schedule', async () => {
    mount(PRACTITIONER, '/admin/schedule');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
  });

  it('lets finance reach the price list', async () => {
    mount(FINANCE, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeTruthy();
  });

  it('sends finance to their own desk instead of the day schedule', async () => {
    mount(FINANCE, '/admin/schedule');
    // billing.price.read admits finance, but appointment.list's practice
    // scope does not — canOpenSchedule refuses, so homeFor lands them on
    // the admin desk (Clients), not the schedule they cannot read.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
  });

  it('shows finance the Billing link but not the Schedule link', async () => {
    mount(FINANCE, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.queryByRole('link', { name: 'Schedule' })).toBeNull();
  });
});

describe('App — /admin/settings/practice', () => {
  it('lets an admin reach the practice settings', async () => {
    mount(ADMIN, '/admin/settings/practice');
    expect(await screen.findByRole('heading', { name: 'Practice' })).toBeTruthy();
  });

  it('sends a lead practitioner to their own desk instead', async () => {
    mount(LEAD_PRACTITIONER, '/admin/settings/practice');
    // practice.settings.write is the owner's and an admin's alone: what a tax
    // invoice says the supplier is, is not a clinical decision.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practice' })).toBeNull();
  });

  it('sends finance to their own desk instead', async () => {
    mount(FINANCE, '/admin/settings/practice');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practice' })).toBeNull();
  });

  it('shows an admin the Settings link', async () => {
    mount(ADMIN, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practice'),
    );
  });

  it('takes the rest of the console out of reach while the drawer is open', async () => {
    // The drawer's `inert` used to be a no-op: it read document.body.children,
    // and the app renders inside #root, so nothing behind it was ever marked
    // and a rail link could take focus from an open drawer (design review,
    // round 20). jsdom implements `inert` as a property and not as behaviour,
    // so the mechanism is asserted directly, and the focus cycle beside it.
    mount(ADMIN, '/admin/settings/practice');
    const edit = await screen.findByRole('button', { name: 'Edit details' });
    // Disabled until the details land: pressing it before then does nothing.
    await waitFor(() => expect(edit).toHaveProperty('disabled', false));
    fireEvent.click(edit);
    const drawer = await screen.findByRole('dialog', { name: 'Practice details' });

    const rail = document.querySelector<HTMLElement>('.rail');
    const main = document.querySelector<HTMLElement>('.admin__main');
    expect(rail?.inert).toBe(true);
    // The drawer's own ancestors stay live, or the drawer would be inert too.
    expect(main?.inert).toBeFalsy();
    expect(drawer.inert).toBeFalsy();
    // Everything else on the page behind it is not.
    expect(document.querySelector<HTMLElement>('.page__header')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('.practice')?.inert).toBe(true);

    // Tab does not walk out of the drawer.
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);

    // And it all comes back when the drawer closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('button', { name: 'Edit details' });
    expect(rail?.inert).toBeFalsy();
    expect(document.querySelector<HTMLElement>('.practice')?.inert).toBeFalsy();
  });

  it('never offers finance a Settings link its own route would refuse', async () => {
    mount(FINANCE, '/admin/clients');
    await screen.findByRole('link', { name: 'Billing' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });
});

describe('App — /admin/settings/practitioners', () => {
  // The second settings screen, and the one with a wider audience than the
  // first: a practitioner records their own home base
  // (docs/SPEC/route-planning.md section 5.4, migration 913).
  it('lets a practitioner reach it', async () => {
    mount(PRACTITIONER, '/admin/settings/practitioners');
    expect(await screen.findByRole('heading', { name: 'Practitioners' })).toBeTruthy();
  });

  it('lets an admin reach it', async () => {
    mount(ADMIN, '/admin/settings/practitioners');
    expect(await screen.findByRole('heading', { name: 'Practitioners' })).toBeTruthy();
  });

  it('sends finance to their own desk instead', async () => {
    mount(FINANCE, '/admin/settings/practitioners');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practitioners' })).toBeNull();
  });

  it('offers a practitioner the one settings screen they may open', async () => {
    mount(PRACTITIONER, '/admin/settings/practitioners');
    expect(await screen.findByRole('link', { name: 'Practitioners' })).toBeTruthy();
    // Practice is the owner's and an admin's, so it is not offered to somebody
    // the route would bounce straight back out of it.
    expect(screen.queryByRole('link', { name: 'Practice' })).toBeNull();
  });

  it('offers the office both, from either screen', async () => {
    mount(OWNER, '/admin/settings/practice');
    expect(await screen.findByRole('link', { name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Practitioners' })).toBeTruthy();
  });
});

/**
 * The door. The operator asked for this round in one sentence — "every
 * practioner can add their own address" — and until the fix round of
 * 2026-09-08 the rail's Settings entry was gated on `practice.settings.write`
 * and pointed at Practice, so the only people who could navigate to the screen
 * were the owner and an admin: the two who could always have had the office set
 * anybody's base (the review of pull request 126, finding B1). These cases pin
 * the promise the round is for, not the shape of the rail.
 */
describe('App — the rail offers Settings to everyone who may open a settings screen', () => {
  it('offers a practitioner Settings, and it lands on Practitioners', async () => {
    mount(PRACTITIONER, '/admin/settings/practitioners');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practitioners'),
    );
  });

  it('offers a lead practitioner the same door, landing on the same screen', async () => {
    mount(LEAD_PRACTITIONER, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practitioners'),
    );
  });

  it('still lands the office on Practice, which they may open', async () => {
    mount(OWNER, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practice'),
    );
  });

  it('offers a practitioner no way to the Practice screen, and no way in by address', async () => {
    mount(PRACTITIONER, '/admin/settings/practitioners');
    await screen.findByRole('link', { name: 'Practitioners' });
    // Not in the strip of settings links, and not in the rail either: the rail's
    // Settings entry is their own screen, never the practice's.
    expect(screen.queryByRole('link', { name: 'Practice' })).toBeNull();
    cleanup();
    // And typing the address still bounces them to their own day.
    mount(PRACTITIONER, '/admin/settings/practice');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practice' })).toBeNull();
  });

  it('offers finance no Settings entry at all: they may open neither screen', async () => {
    mount(FINANCE, '/admin/clients');
    await screen.findByRole('link', { name: 'Billing' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });
});

describe('App — the way across to the practitioner side', () => {
  it('shows a lead practitioner the Today link in the console rail', async () => {
    mount(LEAD_PRACTITIONER, '/admin/clients');
    const link = await screen.findByRole('link', { name: 'Today' });
    expect(link).toHaveProperty('href', expect.stringContaining('/today'));
  });

  it('never shows an admin-only account a Today link it could not open', async () => {
    mount(ADMIN, '/admin/clients');
    await screen.findByRole('link', { name: 'Clients' });
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('shows a practitioner-only account the base door and no console button', async () => {
    mount(PRACTITIONER, '/today');
    await screen.findByText('Nothing is booked for you today.');
    // The console is not their workplace, and that button goes on meaning that.
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
    // One screen inside it is theirs, though, and from the fix round of
    // 2026-09-08 they have a way to it: the operator asked that every
    // practitioner be able to add their own address, and until then the only
    // way in was to type it.
    expect(screen.getByRole('button', { name: 'Your home base' })).toBeTruthy();
  });

  it('takes them there, into the console proper, with the rail and the strip', async () => {
    mount(PRACTITIONER, '/today');
    fireEvent.click(await screen.findByRole('button', { name: 'Your home base' }));
    expect(await screen.findByRole('heading', { name: 'Practitioners' })).toBeTruthy();
    // And the rail's own Settings entry is there once they have arrived.
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practitioners'),
    );
  });

  it('offers a lead practitioner the way back to the console from Today', async () => {
    mount(LEAD_PRACTITIONER, '/today');
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });
});

describe('App — /today is the day sheet for someone who treats', () => {
  it('shows a practitioner their day, not the landing', async () => {
    mount(PRACTITIONER, '/today');
    await screen.findByText('Nothing is booked for you today.');
    expect(screen.queryByText(/There is no day of visits for this account/)).toBeNull();
  });

  it('keeps the landing for an admin-only account that types the address', async () => {
    mount(ADMIN, '/today');
    await screen.findByText(/There is no day of visits for this account/);
    expect(screen.queryByText('Nothing is booked for you today.')).toBeNull();
  });
});

/**
 * The day map is the one document the API serves with a wider content
 * security policy (`app/api/_middleware/security.ts`,
 * docs/SPEC/route-planning.md section 8). What that policy must not reach is
 * any other screen of the practice, and until the fix round of 2026-09-08 it
 * could: the route sat inside the `/admin` layout, whose rail navigates with
 * `NavLink`, and the guard sent a signed-out or unpermitted person on with
 * `<Navigate>` — both client-side, both inside the document already loaded
 * (the review of pull request 121, finding B2).
 */
describe('App — the day map is a document of its own', () => {
  it('renders the map with no rail, so the wider policy reaches one screen', async () => {
    mount(OWNER, '/admin/schedule/map');
    expect(await screen.findByRole('heading', { name: 'Day map' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    // And none of the rail's destinations is one click away inside it.
    expect(screen.queryByRole('link', { name: 'Clients' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Billing' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Audit' })).toBeNull();
  });

  it('offers a signed-out person a plain anchor, never the sign-in form itself', async () => {
    mount(null, '/admin/schedule/map', signedOutProvider);
    expect(await screen.findByText('Sign in to open the day map.')).toBeTruthy();
    const anchor = screen.getByRole('link', { name: 'Sign in' });
    expect(anchor).toHaveProperty('href', expect.stringContaining('/sign-in'));
    // The sign-in form would be the practice's own screen rendered under
    // `'unsafe-eval'`; an anchor loads a new document and the strict policy
    // comes with it. The form's submit is a button named "Sign in" and the
    // way out of here is a link, so this tells the two apart.
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Day map' })).toBeTruthy();
  });

  it('offers a practitioner a plain anchor home, never their own Today screen', async () => {
    mount(PRACTITIONER, '/admin/schedule/map');
    expect(await screen.findByText('You do not have access to the schedule.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your own screen' })).toHaveProperty(
      'href',
      expect.stringContaining('/today'),
    );
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
  });

  it('keeps the rail on every other console screen', async () => {
    mount(OWNER, '/admin/clients');
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy();
  });
});

/**
 * The pin picker (trunk round 43, "the pin on a map") is the second and, for
 * now, last document carrying the wider policy: reached the same way as the
 * day map and for the same reason (`RequirePinDocument`). Unlike the day map
 * it checks no capability of the screen it is opened from — `/admin/clients`
 * has none of its own either — but it is not `/admin/clients`'s strict policy
 * this document carries, so it checks its own bar, `canOpenPin`: every staff
 * role, and not `client_contact`, a household's own actor in this same
 * session (the whole-branch review of trunk round 43, finding 5).
 */
describe('App — the pin picker is a document of its own', () => {
  it('renders the picker with no rail, so the wider policy reaches one screen', async () => {
    mount(OWNER, '/admin/clients/pin');
    expect(
      await screen.findByRole('heading', { name: 'Where the practitioner should arrive' }),
    ).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('offers a signed-out person a plain anchor, never the sign-in form itself', async () => {
    mount(null, '/admin/clients/pin', signedOutProvider);
    expect(await screen.findByText('Sign in to open the pin picker.')).toBeTruthy();
    const anchor = screen.getByRole('link', { name: 'Sign in' });
    expect(anchor).toHaveProperty('href', expect.stringContaining('/sign-in'));
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pin picker' })).toBeTruthy();
  });

  it('offers a household contact a plain anchor to their own portal, never the map', async () => {
    // No practice data is reachable on this screen, so admitting a
    // client_contact would not leak a record — the risk is a household
    // member driving the practice's own browser key and its Places quota
    // from a page handed to them (finding 5).
    mount(CLIENT_CONTACT, '/admin/clients/pin');
    expect(await screen.findByText('You do not have access to the pin picker.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your own screen' })).toHaveProperty(
      'href',
      expect.stringContaining('/portal'),
    );
    expect(
      screen.queryByRole('heading', { name: 'Where the practitioner should arrive' }),
    ).toBeNull();
  });
});
