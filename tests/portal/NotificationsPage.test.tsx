// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OfficePushMessage,
  OfficePushRecordResponse,
  OfficePushResponse,
} from '../../app/api/portal/schema';
import { NotificationsPage } from '../../app/admin/portal/NotificationsPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { json } from './harness';

/**
 * Settings › Notifications, the Send screen (the push memo's decision 3;
 * docs/SPEC/client-portal.md section 3.12): write in both languages, choose
 * the kind, see how many it reaches, send once, and read the record of every
 * message sent. The console is English; the Arabic boxes and preview are the
 * announcements' own allow-listed component.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'a-token-that-unlocks-nothing',
  onChange: () => () => undefined,
};

const SENT = '00000001-0000-4000-8000-0000000000e1';

function message(overrides: Partial<OfficePushMessage> = {}): OfficePushMessage {
  return {
    id: SENT,
    kind: 'announcement',
    title: { en: 'Closed for Eid', ar: 'مغلق في العيد' },
    body: { en: 'The studio is closed from Tuesday.', ar: 'الاستوديو مغلق من الثلاثاء.' },
    sentAt: '2026-10-01T06:00:00.000Z',
    sentOn: '2026-10-01',
    sentBy: 'Iris Harbour',
    recipients: 2,
    devices: 3,
    delivery: { delivered: 2, gone: 1, failed: 0, at: '2026-10-01T06:00:05.000Z' },
    ...overrides,
  };
}

function overview(overrides: Partial<OfficePushResponse> = {}): OfficePushResponse {
  return {
    configured: true,
    today: '2026-10-06',
    audience: {
      announcement: { people: 2, devices: 3 },
      offer: { people: 1, devices: 2 },
    },
    offersLeft: 2,
    messages: [message()],
    ...overrides,
  };
}

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
    const answer = answers[`${init?.method ?? 'GET'} ${path}`];
    return answer ? answer(init) : json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <MemoryRouter initialEntries={['/admin/settings/notifications']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <NotificationsPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { ...view, calls };
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function writeOne(): void {
  fill('English title', 'A season price');
  fill('English text', 'Ten sessions at the season price this month.');
  fill('Arabic title', 'سعر الموسم');
  fill('Arabic text', 'عشر جلسات بسعر الموسم هذا الشهر.');
}

describe('Settings › Notifications', () => {
  it('says how many each kind reaches today, and lists every message sent with its delivery', async () => {
    mount({ 'GET /api/portal/push': () => json(overview()) });
    expect(await screen.findByText('Closed for Eid')).toBeTruthy();
    expect(screen.getByText('2 people on 3 devices')).toBeTruthy();
    expect(screen.getByText('1 person on 2 devices')).toBeTruthy();
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByText('2 delivered, 1 gone')).toBeTruthy();
    expect(screen.getByText('Iris Harbour')).toBeTruthy();
  });

  it('says push is not configured, and offers nothing to send, without the key pair', async () => {
    mount({
      'GET /api/portal/push': () => json(overview({ configured: false, messages: [] })),
    });
    expect(await screen.findByText(/Push is not configured/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write a notification' })).toBeNull();
  });

  it('writes in both languages, previews it as a phone shows it, and sends once with a reason', async () => {
    const { calls } = mount({
      'GET /api/portal/push': () => json(overview()),
      'POST /api/portal/push/messages': () =>
        json(
          { message: message({ kind: 'offer', title: { en: 'A season price', ar: 'x' } }) },
          201,
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Write a notification' }));
    const drawer = within(screen.getByRole('dialog'));
    fireEvent.click(drawer.getByLabelText(/^Offer/));
    writeOne();
    fireEvent.click(drawer.getByRole('button', { name: 'Preview' }));
    // The offer's stop is in both previews, as the phone shows it.
    expect(drawer.getByText(/To stop offers, turn the switch off under Agreements\./)).toBeTruthy();
    expect(drawer.getByText(/This offer will reach 1 person on 2 devices today/)).toBeTruthy();
    const send = drawer.getByRole('button', { name: 'Send once' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fill('Reason', 'October season price');
    fireEvent.click(send);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/The offer is on its way/)).toBeTruthy();
    const post = calls.find((call) => call.path === '/api/portal/push/messages');
    const body = JSON.parse(String(post?.init?.body)) as { id: string; kind: string };
    expect(body.kind).toBe('offer');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Headers(post?.init?.headers).get('x-reason')).toBe('October season price');
  });

  it('catches a medical word before anything is sent', async () => {
    const { calls } = mount({ 'GET /api/portal/push': () => json(overview()) });
    fireEvent.click(await screen.findByRole('button', { name: 'Write a notification' }));
    writeOne();
    fill('English text', 'A discount on therapy sessions.');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/uses a word of another kind of practice/)).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/portal/push/messages')).toBe(false);
  });

  it('offers no offer when two have gone this month', async () => {
    mount({ 'GET /api/portal/push': () => json(overview({ offersLeft: 0 })) });
    fireEvent.click(await screen.findByRole('button', { name: 'Write a notification' }));
    const offer = screen.getByLabelText(/^Offer/) as HTMLInputElement;
    expect(offer.disabled).toBe(true);
    expect(screen.getByText('Two offers have already gone this calendar month.')).toBeTruthy();
  });

  it('says why when the server refuses the third offer', async () => {
    mount({
      'GET /api/portal/push': () => json(overview()),
      'POST /api/portal/push/messages': () => json({ error: 'offer_ceiling' }, 409),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Write a notification' }));
    fireEvent.click(screen.getByLabelText(/^Offer/));
    writeOne();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fill('Reason', 'October season price');
    fireEvent.click(screen.getByRole('button', { name: 'Send once' }));
    expect(
      await screen.findByText(/Two offers have already gone this calendar month\./),
    ).toBeTruthy();
  });

  it('opens the record of a message: who it went to, and each one’s consent then', async () => {
    const record: OfficePushRecordResponse = {
      message: message({ kind: 'offer' }),
      recipients: [
        { name: 'Hazel Meadow', devices: 2, standing: 'on', wordingVersion: '1.0' },
        { name: 'Saffron Dune', devices: 1, standing: 'off', wordingVersion: null },
      ],
    };
    mount({
      'GET /api/portal/push': () => json(overview()),
      [`GET /api/portal/push/messages/${SENT}`]: () => json(record),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    const drawer = within(await screen.findByRole('dialog'));
    expect(await drawer.findByText('Hazel Meadow')).toBeTruthy();
    expect(drawer.getByText('On, wording 1.0')).toBeTruthy();
    expect(drawer.getByText('Off')).toBeTruthy();
  });

  it('is the owner’s and an admin’s: anybody else is told so', async () => {
    mount({ 'GET /api/portal/push': () => json({ error: 'forbidden' }, 403) });
    expect(await screen.findByText(/owner’s and an admin’s to send/)).toBeTruthy();
  });
});
