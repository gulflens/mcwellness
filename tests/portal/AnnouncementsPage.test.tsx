// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeAnnouncement, OfficeAnnouncementsResponse } from '../../app/api/portal/schema';
import { AnnouncementsPage } from '../../app/admin/portal/AnnouncementsPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { json } from './harness';

/**
 * Settings › Announcements (docs/SPEC/client-portal.md section 3.10; the push
 * memo's decision 4): the owner and an admin write the practice's news for
 * every household's home, in both languages, preview it, publish it, and
 * withdraw it. Never edit it: a correction is a new announcement.
 *
 * The console is English; the Arabic boxes and the Arabic preview are the one
 * place Arabic is typed and drawn, and say so to a screen reader.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'a-token-that-unlocks-nothing',
  onChange: () => () => undefined,
};

const STANDING = '00000001-0000-4000-8000-0000000000e1';
const GONE = '00000001-0000-4000-8000-0000000000e2';

function announcement(overrides: Partial<OfficeAnnouncement> = {}): OfficeAnnouncement {
  return {
    id: STANDING,
    title: { en: 'Closed for Eid', ar: 'مغلق في العيد' },
    body: { en: 'The studio is closed from Tuesday.', ar: 'الاستوديو مغلق من الثلاثاء.' },
    visibleFrom: null,
    visibleUntil: '2026-10-09',
    publishedAt: '2026-10-01T06:00:00.000Z',
    publishedOn: '2026-10-01',
    publishedBy: 'Iris Harbour',
    withdrawnAt: null,
    withdrawnBy: null,
    supersedesId: null,
    correctedById: null,
    state: 'current',
    ...overrides,
  };
}

const LIST: OfficeAnnouncementsResponse = {
  today: '2026-10-06',
  announcements: [
    announcement(),
    announcement({
      id: GONE,
      title: { en: 'A new practitioner', ar: 'ممارسة جديدة' },
      state: 'withdrawn',
      withdrawnAt: '2026-10-02T06:00:00.000Z',
      withdrawnBy: 'Iris Harbour',
    }),
  ],
};

function mount(answers: Record<string, (init?: RequestInit) => Response> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === '/api/me') {
      return json({
        userId: '00000001-0000-4000-8000-000000000011',
        displayName: 'Iris Harbour',
        tenantId: '00000000-0000-4000-8000-00000000000a',
        roles: ['admin'],
        capabilities: [],
        preferredLocale: 'en',
      });
    }
    const key = `${init?.method ?? 'GET'} ${path}`;
    const answer = answers[key];
    return answer ? answer(init) : json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <MemoryRouter initialEntries={['/admin/settings/announcements']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <AnnouncementsPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { ...view, calls };
}

const LISTED = { 'GET /api/portal/announcements': () => json(LIST) };

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function writeOne(): void {
  fill('English title', 'A new practitioner');
  fill('English text', 'A second practitioner has joined the practice.');
  fill('Arabic title', 'ممارسة جديدة');
  fill('Arabic text', 'انضمت ممارسة ثانية إلى المركز.');
}

describe('Settings › Announcements', () => {
  it('lists every announcement with its state, and offers withdraw and correct only on a standing one', async () => {
    mount(LISTED);
    expect(await screen.findByText('Closed for Eid')).toBeTruthy();
    expect(screen.getByText('Shown now')).toBeTruthy();
    expect(screen.getByText('Withdrawn')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    const standing = rows.find((row) => row.textContent?.includes('Closed for Eid'));
    const gone = rows.find((row) => row.textContent?.includes('A new practitioner'));
    expect(within(standing as HTMLElement).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(within(standing as HTMLElement).getByRole('button', { name: 'Correct' })).toBeTruthy();
    expect(within(gone as HTMLElement).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    // The list is the console's: English titles only.
    expect(screen.queryByText('مغلق في العيد')).toBeNull();
  });

  it('says a current announcement beyond the newest three is not shown, and why', async () => {
    const FOURTH = '00000001-0000-4000-8000-0000000000e3';
    mount({
      'GET /api/portal/announcements': () =>
        json({
          ...LIST,
          announcements: [
            ...LIST.announcements,
            announcement({
              id: FOURTH,
              title: { en: 'An older note', ar: 'ملاحظة أقدم' },
              state: 'current_not_shown',
            }),
          ],
        }),
    });
    const row = (await screen.findByText('An older note')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Current, not shown')).toBeTruthy();
    expect(within(row).getByText(/three newer announcements are shown/i)).toBeTruthy();
  });

  it('offers no second correction of one already corrected', async () => {
    mount({
      'GET /api/portal/announcements': () =>
        json({ ...LIST, announcements: [announcement({ correctedById: GONE })] }),
    });
    const row = (await screen.findByText('Closed for Eid')).closest('tr') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Correct' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('asks the writer to confirm an ambiguous word at preview, and sends the confirmation', async () => {
    let posted: RequestInit | undefined;
    mount({
      ...LISTED,
      'POST /api/portal/announcements': (init) => {
        posted = init;
        return json({ announcement: announcement({ id: GONE }) }, 201);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    writeOne();
    fill('English title', 'A treat for Eid');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Preview' });
    expect(screen.getByText(/“treat”, in the English title/)).toBeTruthy();
    fill('Reason', 'Practice news for the households');
    const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /not a medical claim/ }));
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    await waitFor(() => expect(posted).toBeTruthy());
    expect(JSON.parse(String(posted?.body)).confirmedWarnings).toBe(true);
  });

  it('says so, plainly, when there are none', async () => {
    mount({
      'GET /api/portal/announcements': () => json({ today: '2026-10-06', announcements: [] }),
    });
    expect(await screen.findByText(/No announcement has been published/)).toBeTruthy();
  });

  it('says whose screen this is when the route refuses', async () => {
    mount({ 'GET /api/portal/announcements': () => json({ error: 'forbidden' }, 403) });
    expect(await screen.findByText(/the owner’s and an admin’s/)).toBeTruthy();
  });

  it('takes the Arabic in boxes marked as Arabic, read from the right', async () => {
    mount(LISTED);
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    const title = screen.getByLabelText('Arabic title');
    expect(title.getAttribute('lang')).toBe('ar');
    expect(title.getAttribute('dir')).toBe('rtl');
    expect(screen.getByLabelText('English title').getAttribute('dir')).toBeNull();
  });

  it('previews both languages as a household will read them before anything is sent', async () => {
    const { calls } = mount(LISTED);
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    writeOne();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('A new practitioner')).toBeTruthy();
    expect(within(preview).getByText('ممارسة جديدة').closest('[dir]')?.getAttribute('dir')).toBe(
      'rtl',
    );
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('refuses a medical word at the preview, in the field it is in, and sends nothing', async () => {
    const { calls } = mount(LISTED);
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    writeOne();
    fill('English text', 'A new therapy room has opened.');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/a word of another kind of practice/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
  });

  it('publishes with the reason given, and lists it', async () => {
    let posted: RequestInit | undefined;
    const { calls } = mount({
      ...LISTED,
      'POST /api/portal/announcements': (init) => {
        posted = init;
        return json({ announcement: announcement({ id: GONE }) }, 201);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    writeOne();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Preview' });
    const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fill('Reason', 'Practice news for the households');
    fireEvent.click(publish);

    await waitFor(() => expect(posted).toBeTruthy());
    expect(new Headers(posted?.headers).get('x-reason')).toBe('Practice news for the households');
    expect(JSON.parse(String(posted?.body))).toEqual({
      title: { en: 'A new practitioner', ar: 'ممارسة جديدة' },
      body: {
        en: 'A second practitioner has joined the practice.',
        ar: 'انضمت ممارسة ثانية إلى المركز.',
      },
      visibleFrom: null,
      visibleUntil: null,
      supersedesId: null,
      confirmedWarnings: false,
    });
    await waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/portal/announcements').length).toBe(3),
    );
  });

  it('corrects one by publishing a new one in its place, the words carried over', async () => {
    let posted: RequestInit | undefined;
    mount({
      ...LISTED,
      'POST /api/portal/announcements': (init) => {
        posted = init;
        return json({ announcement: announcement({ id: GONE, supersedesId: STANDING }) }, 201);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Correct' }));
    expect((screen.getByLabelText('English title') as HTMLInputElement).value).toBe(
      'Closed for Eid',
    );
    expect(screen.getByText(/replaced by this one/)).toBeTruthy();
    fill('English title', 'Closed for Eid al-Adha');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Preview' });
    fill('Reason', 'The title named the wrong holiday');
    fireEvent.click(screen.getByRole('button', { name: 'Publish the correction' }));
    await waitFor(() => expect(posted).toBeTruthy());
    expect(JSON.parse(String(posted?.body)).supersedesId).toBe(STANDING);
  });

  it('withdraws one with the reason given', async () => {
    let posted: RequestInit | undefined;
    mount({
      ...LISTED,
      [`POST /api/portal/announcements/${STANDING}/withdraw`]: (init) => {
        posted = init;
        return json({ ok: true });
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    fill('Reason', 'The studio is open after all');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the announcement' }));
    await waitFor(() => expect(posted).toBeTruthy());
    expect(new Headers(posted?.headers).get('x-reason')).toBe('The studio is open after all');
  });

  it('says why when the server refuses the wording', async () => {
    mount({
      ...LISTED,
      'POST /api/portal/announcements': () =>
        json({ error: 'wording', problems: [{ field: 'visibleUntil', code: 'in_the_past' }] }, 422),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Write an announcement' }));
    writeOne();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Preview' });
    fill('Reason', 'Practice news for the households');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/The last day has already gone/)).toBeTruthy();
  });
});
