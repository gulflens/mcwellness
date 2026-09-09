// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Enquiry } from '../../api/enquiries/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { EnquiriesPage } from './EnquiriesPage';

/**
 * The enquiries screen. Synthetic throughout (.claude/rules/testing.md): seed
 * names, the fixture phone range.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const NEW: Enquiry = {
  id: '0000000e-0000-4000-8000-000000000001',
  receivedAt: '2026-09-09T19:30:00.000Z',
  source: 'website',
  status: 'new',
  name: 'Hazel Harbour',
  whatsappE164: '+971500000099',
  email: 'hazel@example.com',
  area: 'Jumeirah',
  message: 'I want to know more\nabout neurofeedback',
  concern: 'Sleep Improvement',
  preferredTime: 'Evenings',
  contactMethod: 'WhatsApp',
  consent: true,
  actionedAt: null,
  actionedByName: null,
  clientId: null,
  dismissReason: null,
};
const CONVERTED: Enquiry = {
  ...NEW,
  id: '0000000e-0000-4000-8000-000000000002',
  status: 'converted',
  name: null,
  whatsappE164: null,
  email: null,
  area: null,
  message: null,
  concern: null,
  preferredTime: null,
  contactMethod: null,
  consent: null,
  actionedAt: '2026-09-09T19:40:00.000Z',
  actionedByName: 'Iris Harbour',
  clientId: '00000008-0000-4000-8000-000000000011',
};

function mount(options: { listStatus?: number; list?: Enquiry[] } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  let list: Enquiry[] = options.list ?? [NEW, CONVERTED];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Iris Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['admin'],
        capabilities: [],
      });
    }
    if (url === '/api/enquiries' && (!init || !init.method || init.method === 'GET')) {
      return json({ enquiries: list }, options.listStatus ?? 200);
    }
    if (url.endsWith('/convert')) {
      posts.push({ url, body: init?.body });
      list = [{ ...CONVERTED, id: NEW.id, actionedByName: 'Iris Harbour' }, CONVERTED];
      return json({ clientId: CONVERTED.clientId, mrn: 'MW-000012' }, 201);
    }
    if (url.endsWith('/dismiss')) {
      posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      list = [
        {
          ...NEW,
          status: 'dismissed',
          name: null,
          whatsappE164: null,
          message: null,
          dismissReason: 'Spam',
          actionedByName: 'Iris Harbour',
        },
        CONVERTED,
      ];
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/admin/enquiries']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <EnquiriesPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { posts };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('EnquiriesPage', () => {
  it('says how long an enquiry still new after thirty days has waited, and leaves Dismiss beside it', async () => {
    // The operator's decision of 10 September 2026 (decision 3 of
    // docs/OPERATOR/2026-09-10-decisions.md). The clock is the page's own
    // reading of today; only Date is faked, so the page's fetches still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
    try {
      const waiting: Enquiry = {
        ...NEW,
        id: '0000000e-0000-4000-8000-000000000003',
        receivedAt: '2026-08-01T08:00:00.000Z',
        name: 'Cedar Orchard',
      };
      mount({ list: [NEW, waiting, CONVERTED] });
      expect(await screen.findByText('Waiting 40 days')).toBeTruthy();
      // The one received yesterday is simply new.
      expect(screen.getAllByText('New')).toHaveLength(1);
      // Two new rows, two Dismiss buttons: nothing dismisses itself.
      expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists what the forms sent, new first, with the first line of the message and a link for a lead', async () => {
    mount();
    expect(await screen.findByText('Hazel Harbour')).toBeTruthy();
    expect(screen.getByText('+971500000099')).toBeTruthy();
    expect(screen.getByText('I want to know more')).toBeTruthy();
    expect(screen.queryByText(/about neurofeedback/)).toBeNull();
    for (const line of [
      'Area: Jumeirah',
      'Asked about: Sleep Improvement',
      'Prefers: Evenings',
      'Reach by: WhatsApp',
    ]) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Lead' }).getAttribute('href')).toBe(
      `/admin/clients/${CONVERTED.clientId}`,
    );
    // The converted row keeps nothing personal, and says so with a dash.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('converts a new enquiry and names the lead it became', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to lead' }));
    expect(await screen.findByText(/Converted to a lead: MW-000012/)).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/enquiries/${NEW.id}/convert`, body: '{}' }]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Convert to lead' })).toBeNull(),
    );
  });

  it('dismisses only with a reason, and sends it', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    const confirm = screen.getByRole('button', { name: 'Dismiss' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Spam' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    expect(await screen.findByText('Dismissed.')).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/enquiries/${NEW.id}/dismiss`, body: { reason: 'Spam' } }]);
  });

  it('says so when the list cannot be loaded', async () => {
    mount({ listStatus: 500 });
    expect(await screen.findByText('The enquiries could not be loaded. Try again.')).toBeTruthy();
  });
});
