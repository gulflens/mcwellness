// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  enquiringFor: null,
  interest: null,
  // Lodged under the earlier wording, as every enquiry to date was.
  noticeVersion: 1,
  marketingOptIn: null,
  actionedAt: null,
  actionedByName: null,
  clientId: null,
  dismissReason: null,
};
const EXPO: Enquiry = {
  ...NEW,
  id: '0000000e-0000-4000-8000-000000000004',
  receivedAt: '2026-10-14T11:20:00.000Z',
  source: 'expo',
  name: 'Rowan Meadow',
  whatsappE164: '+971500000098',
  email: null,
  area: 'Mirdif',
  message: 'Saw the stand',
  concern: null,
  preferredTime: null,
  contactMethod: null,
  enquiringFor: 'child',
  interest: 'both',
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
  enquiringFor: null,
  interest: null,
  actionedAt: '2026-09-09T19:40:00.000Z',
  actionedByName: 'Iris Harbour',
  clientId: '00000008-0000-4000-8000-000000000011',
};

/** Lodged under the second wording, and asked for the practice's news. */
const TOLD: Enquiry = {
  ...EXPO,
  id: '0000000e-0000-4000-8000-000000000005',
  name: 'Iris Creek',
  whatsappE164: '+971500000097',
  email: 'iris@example.com',
  noticeVersion: 2,
  marketingOptIn: true,
};
/** The same person once dismissed and kept: still named, and who dismissed them and why. */
const KEPT: Enquiry = {
  ...TOLD,
  id: '0000000e-0000-4000-8000-000000000006',
  status: 'dismissed',
  actionedAt: '2026-10-16T08:15:00.000Z',
  actionedByName: 'Iris Harbour',
  dismissReason: 'Not now, maybe after the summer',
};

const DISMISSED: Enquiry = {
  ...CONVERTED,
  id: '0000000e-0000-4000-8000-000000000003',
  status: 'dismissed',
  source: 'expo',
  receivedAt: '2026-10-14T09:05:00.000Z',
  actionedAt: '2026-10-16T08:15:00.000Z',
  actionedByName: 'Iris Harbour',
  clientId: null,
  dismissReason: 'Stand test',
};

/** More dismissed rows than a page holds, each a minute older than the last. */
function crowd(size: number): Enquiry[] {
  return Array.from({ length: size }, (_, index) => ({
    ...DISMISSED,
    id: `0000000e-0000-4000-8000-${String(100000 + index).padStart(12, '0')}`,
    receivedAt: new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - index * 60_000).toISOString(),
    dismissReason: `Stand test ${index + 1}`,
  }));
}

function mount(
  options: {
    listStatus?: number;
    list?: Enquiry[];
    holdOlder?: Promise<void>;
    failOlder?: boolean;
  } = {},
) {
  const posts: { url: string; body: unknown }[] = [];
  /** Every list the screen asked for, in order: what it fetched, and what it did not. */
  const lists: string[] = [];
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
    if (
      (url === '/api/enquiries' || url.startsWith('/api/enquiries?')) &&
      (!init || !init.method || init.method === 'GET')
    ) {
      lists.push(url);
      // A later page can be held back, to be let go after the screen has moved on.
      if (options.holdOlder && url.includes('before=')) await options.holdOlder;
      if (options.failOlder && url.includes('before=')) return json({ error: 'internal' }, 500);
      return json(served(list, url), options.listStatus ?? 200);
    }
    if (url === '/api/enquiries/expo.csv') {
      posts.push({ url, body: null });
      return new Response('Received,Name\r\n', {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="expo-leads-2026-10-15.csv"',
        },
      });
    }
    if (url.endsWith('/convert')) {
      posts.push({ url, body: init?.body });
      list = [{ ...CONVERTED, id: NEW.id, actionedByName: 'Iris Harbour' }, CONVERTED];
      return json({ clientId: CONVERTED.clientId, mrn: 'MW-000012' }, 201);
    }
    if (url === '/api/enquiries/marketing.csv') {
      posts.push({ url, body: null });
      return new Response('Name,WhatsApp\r\n', {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="news-list-2026-10-16.csv"',
        },
      });
    }
    const scrubbed = {
      name: null,
      whatsappE164: null,
      email: null,
      area: null,
      message: null,
      enquiringFor: null,
      interest: null,
      marketingOptIn: null,
    };
    if (url.endsWith('/dismiss')) {
      const sent = init?.body
        ? (JSON.parse(String(init.body)) as { reason: string; erase?: boolean })
        : null;
      posts.push({ url, body: sent });
      const id = url.split('/').at(-2);
      let kept = false;
      list = list.map((row) => {
        if (row.id !== id) return row;
        // As the route does: kept only under the second wording, and only if nobody chose to erase.
        kept = row.noticeVersion === 2 && sent?.erase !== true;
        return {
          ...row,
          ...(kept ? {} : scrubbed),
          status: 'dismissed',
          dismissReason: sent?.reason ?? '',
          actionedAt: '2026-10-16T08:15:00.000Z',
          actionedByName: 'Iris Harbour',
        };
      });
      return json({ ok: true, kept });
    }
    if (url.endsWith('/erase')) {
      posts.push({ url, body: null });
      const id = url.split('/').at(-2);
      list = list.map((row) => (row.id === id ? { ...row, ...scrubbed } : row));
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
  return { posts, lists };
}

/**
 * The list as `app/api/enquiries/routes.ts` answers it: one status, one source
 * if asked, newest first, a hundred to the page, with every status counted.
 */
function served(all: readonly Enquiry[], url: string) {
  const query = new URL(url, 'http://console.test').searchParams;
  const status = query.get('status') ?? 'new';
  const source = query.get('source');
  const before = query.get('before');
  const cursorOf = (row: Enquiry): string => `${row.receivedAt}_${row.id}`;
  const newestFirst = [...all].sort((a, b) => (cursorOf(a) < cursorOf(b) ? 1 : -1));
  const matching = newestFirst
    .filter((row) => row.status === status && (source === null || row.source === source))
    .filter((row) => before === null || cursorOf(row) < before);
  const page = matching.slice(0, 100);
  const last = page.at(-1);
  const none = () => ({ all: 0, website: 0, discovery_call: 0, expo: 0 });
  const counts = { new: none(), converted: none(), dismissed: none() };
  for (const row of all) {
    counts[row.status][row.source] += 1;
    counts[row.status].all += 1;
  }
  const marketable = all.filter(
    (row) => row.marketingOptIn === true && row.name !== null && row.status !== 'converted',
  ).length;
  return {
    enquiries: page,
    counts,
    older: matching.length > 100 && last ? cursorOf(last) : null,
    marketable,
  };
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

  it('lists what is waiting, with the first line of the message, and no lead among them', async () => {
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
    // What became a lead is not in this table: it has one of its own.
    expect(screen.queryByRole('link', { name: 'Open the lead' })).toBeNull();
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
    // Lodged under the earlier wording: no choice is offered, and the screen says why.
    expect(
      screen.getByText(
        'This person was told the enquiry keeps nothing personal, so dismissing erases their details.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(confirm);
    expect(
      await screen.findByText('Dismissed, and their details erased, as this person was told.'),
    ).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/enquiries/${NEW.id}/dismiss`, body: { reason: 'Spam' } }]);
  });

  it('shows who an expo enquiry is for and what they asked about', async () => {
    mount({ list: [EXPO, NEW, CONVERTED] });
    expect(await screen.findByText('Rowan Meadow')).toBeTruthy();
    expect(screen.getByText('For: a child')).toBeTruthy();
    expect(screen.getByText('Interested in: both')).toBeTruthy();
    expect(screen.getByText('Expo')).toBeTruthy();
  });

  it('filters by source and counts each', async () => {
    mount({ list: [EXPO, NEW, CONVERTED] });
    await screen.findByText('Rowan Meadow');
    const filter = screen.getByRole('group', { name: 'From' });
    // The two that are waiting: the lead is counted on its own tab.
    expect(
      within(filter).getByRole('button', { name: 'All (2)' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(filter).getByRole('button', { name: 'Website (1)' })).toBeTruthy();
    expect(within(filter).getByRole('button', { name: 'Discovery call (0)' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: 'Expo (1)' }));
    await waitFor(() => expect(screen.queryByText('Hazel Harbour')).toBeNull());
    expect(screen.getByText('Rowan Meadow')).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: 'Discovery call (0)' }));
    expect(await screen.findByText('Nothing waiting from a discovery call.')).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: 'Expo (1)' }));
    await screen.findByText('Rowan Meadow');
    expect(screen.queryByText(/Nothing waiting/)).toBeNull();
  });

  it('keeps what is waiting, what became a lead and what was dismissed in tables of their own', async () => {
    const { lists } = mount({ list: [EXPO, NEW, CONVERTED, DISMISSED] });
    await screen.findByText('Rowan Meadow');
    const tabs = screen.getByRole('navigation', { name: 'Enquiries by status' });
    expect(
      within(tabs).getByRole('button', { name: 'Active (2)' }).getAttribute('aria-current'),
    ).toBe('page');
    // Only what is waiting was fetched: a dismissed row costs nothing until it is asked for.
    expect(lists).toEqual(['/api/enquiries?status=new']);
    expect(screen.queryByText('Stand test')).toBeNull();

    fireEvent.click(within(tabs).getByRole('button', { name: 'Dismissed (1)' }));
    expect(await screen.findByText('Stand test')).toBeTruthy();
    expect(lists.at(-1)).toBe('/api/enquiries?status=dismissed');
    expect(screen.queryByText('Hazel Harbour')).toBeNull();
    // Who they were, where a dismissed row was allowed to keep them, and what happened.
    const dismissed = screen.getByRole('table', { name: 'Dismissed enquiries, newest first' });
    expect(
      within(dismissed)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      'Received',
      'Name',
      'WhatsApp',
      'From',
      'Message',
      'Details',
      'Dismissed',
      'By',
      'Why',
      '',
    ]);
    expect(within(dismissed).getByText('16 Oct 2026, 12:15')).toBeTruthy();
    expect(within(dismissed).getByText('Iris Harbour')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Convert to lead' })).toBeNull();

    fireEvent.click(within(tabs).getByRole('button', { name: 'Converted (1)' }));
    const lead = await screen.findByRole('link', { name: 'Open the lead' });
    expect(lead.getAttribute('href')).toBe(`/admin/clients/${CONVERTED.clientId}`);
    expect(lists.at(-1)).toBe('/api/enquiries?status=converted');
  });

  it('shows a page of a long list, says how many there are, and fetches older ones on a press', async () => {
    const { lists } = mount({ list: [NEW, ...crowd(130)] });
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (130)' }));
    expect(await screen.findByText('Stand test 1')).toBeTruthy();
    expect(screen.getByText('Showing 100 of 130.')).toBeTruthy();
    expect(screen.queryByText('Stand test 101')).toBeNull();

    const showOlder = screen.getByRole('button', { name: 'Show older' });
    showOlder.focus();
    fireEvent.click(showOlder);
    // Never `disabled` while it fetches: a disabled button drops the focus it holds.
    expect(showOlder.hasAttribute('disabled')).toBe(false);
    expect(await screen.findByText('Stand test 130')).toBeTruthy();
    // Added beneath what was there, not in place of it.
    expect(screen.getByText('Stand test 1')).toBeTruthy();
    expect(lists.at(-1)).toMatch(/^\/api\/enquiries\?status=dismissed&before=/);
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    // The line stays to say the list is whole, in a region a screen reader is
    // told of, and the focus the button held goes to it and not to the top of
    // the page.
    const whole = screen.getByText('Showing all 130.');
    const region = whole.closest('[role="status"]');
    expect(region).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(region));
  });

  it('lets go of an error about one table when another is opened', async () => {
    mount({ list: [NEW, ...crowd(130)], failOlder: true });
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (130)' }));
    await screen.findByText('Stand test 1');
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(
      await screen.findByText('The older enquiries could not be loaded. Try again.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Active (1)' }));
    await screen.findByText('Hazel Harbour');
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('keeps a person who was told they would be kept, and shows them in the Dismissed table', async () => {
    const { posts } = mount({ list: [TOLD] });
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    // Kept unless somebody chooses otherwise.
    const keep = screen.getByRole('radio', { name: 'Keep their details for follow-up' });
    expect((keep as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Not now' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(
      await screen.findByText('Dismissed. Their details are kept in the Dismissed table.'),
    ).toBeTruthy();
    expect(posts).toEqual([
      { url: `/api/enquiries/${TOLD.id}/dismiss`, body: { reason: 'Not now', erase: false } },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (1)' }));
    const table = await screen.findByRole('table', { name: 'Dismissed enquiries, newest first' });
    expect(within(table).getByText('Iris Creek')).toBeTruthy();
    expect(within(table).getByText('+971500000097')).toBeTruthy();
    expect(within(table).getByText('Email: iris@example.com')).toBeTruthy();
    expect(within(table).getByText('Asked for news and offers')).toBeTruthy();
    expect(within(table).getByText('Not now')).toBeTruthy();
  });

  it('erases at the moment of dismissing when that is chosen', async () => {
    const { posts } = mount({ list: [TOLD] });
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Erase their details' }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Wrong number' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(await screen.findByText('Dismissed, and their details erased.')).toBeTruthy();
    expect(posts.at(-1)?.body).toEqual({ reason: 'Wrong number', erase: true });
  });

  it('erases a kept person later, after asking once, and says what is left', async () => {
    const { posts } = mount({ list: [NEW, KEPT, DISMISSED] });
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (2)' }));
    await screen.findByText('Iris Creek');
    // The row with nobody left on it says so, and has nothing to erase.
    expect(screen.getByText('Details erased')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Erase details' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Erase details' }));
    expect(screen.getByText('Erase their details? This cannot be undone.')).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    expect(
      await screen.findByText(
        'Details erased. The row keeps when it came and why it was dismissed.',
      ),
    ).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/enquiries/${KEPT.id}/erase`, body: null }]);
    await waitFor(() => expect(screen.queryByText('Iris Creek')).toBeNull());
    expect(screen.getAllByText('Details erased')).toHaveLength(2);
  });

  it('offers the news list only while somebody who asked for it is on a row', async () => {
    const { posts } = mount({ list: [TOLD, NEW] });
    await screen.findByText('Iris Creek');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:news',
      revokeObjectURL: () => undefined,
    });
    expect(screen.getByText(/people who asked for McWellness news/)).toBeTruthy();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download news list (1)' }));
      await waitFor(() =>
        expect(posts).toEqual([{ url: '/api/enquiries/marketing.csv', body: null }]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    cleanup();
    mount({ list: [NEW, EXPO] });
    await screen.findByText('Hazel Harbour');
    expect(screen.queryByRole('button', { name: /Download news list/ })).toBeNull();
  });

  it('leaves the table alone when the tab or the source already open is pressed again', async () => {
    const { lists } = mount({ list: [EXPO, NEW] });
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Active (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'All (2)' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing changed, so nothing was cleared and nothing was fetched again.
    expect(screen.getByText('Hazel Harbour')).toBeTruthy();
    expect(screen.queryByText('Loading.')).toBeNull();
    expect(lists).toEqual(['/api/enquiries?status=new']);
  });

  it('drops an older page that arrives after somebody has opened another table', async () => {
    let letGo: () => void = () => undefined;
    const holdOlder = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    mount({ list: [NEW, ...crowd(130)], holdOlder });
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (130)' }));
    await screen.findByText('Stand test 1');
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    // Back to what is waiting, while the dismissed table's next page is still on its way.
    fireEvent.click(screen.getByRole('button', { name: 'Active (1)' }));
    await screen.findByText('Hazel Harbour');
    letGo();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Stand test/)).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('takes a dismissed enquiry out of the active table and counts it where it went', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Spam' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(
      await screen.findByText('Dismissed, and their details erased, as this person was told.'),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Hazel Harbour')).toBeNull());
    expect(screen.getByRole('button', { name: 'Active (0)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismissed (1)' })).toBeTruthy();
    expect(screen.getByText('Nothing waiting. New enquiries land here.')).toBeTruthy();
  });

  it('downloads the expo leads file, and offers it only while an expo enquiry waits', async () => {
    const { posts } = mount({ list: [EXPO, NEW] });
    await screen.findByText('Rowan Meadow');
    // jsdom has no object URLs; the download helper's own test covers the click.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:leads',
      revokeObjectURL: () => undefined,
    });
    expect(screen.getByText(/Keep it on the practice’s own device/)).toBeTruthy();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download expo leads' }));
      await waitFor(() => expect(posts).toEqual([{ url: '/api/enquiries/expo.csv', body: null }]));
    } finally {
      vi.unstubAllGlobals();
    }
    cleanup();
    mount({ list: [NEW, CONVERTED] });
    await screen.findByText('Hazel Harbour');
    expect(screen.queryByRole('button', { name: 'Download expo leads' })).toBeNull();
    expect(screen.queryByText(/Keep it on the practice’s own device/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Expo poster' }).getAttribute('href')).toBe(
      '/admin/enquiries/poster',
    );
  });

  it('says so when the list cannot be loaded', async () => {
    mount({ listStatus: 500 });
    expect(await screen.findByText('The enquiries could not be loaded. Try again.')).toBeTruthy();
  });
});
