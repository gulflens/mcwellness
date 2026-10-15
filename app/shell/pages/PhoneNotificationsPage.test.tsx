// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../auth/AuthContext';
import type { AuthProvider } from '../auth/types';
import { PhoneNotificationsPage } from './PhoneNotificationsPage';

/**
 * The console's "Phone notifications" switch (the practice's list of 6
 * October 2026, item 7): offered to the people who see Enquiries when the
 * practice has its key pair, in English, one press each way. The browser's
 * half is stood up as a fake; nothing here reaches a push service.
 */

const device = vi.hoisted(() => ({
  state: 'off' as string,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../../client/pushDevice', () => ({
  deviceState: async () => device.state,
  subscribeDevice: device.subscribe,
  unsubscribeDevice: device.unsubscribe,
}));

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'a-token-that-unlocks-nothing',
  onChange: () => () => undefined,
};

const SUBSCRIBED = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-console',
  keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(answer: { configured: boolean; offered: boolean; devices?: number }) {
  const posts: { path: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
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
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return json(
        { configured: true, offered: true, publicKey: 'BPracticeKey', devices: 1 },
        path.endsWith('/remove') ? 200 : 201,
      );
    }
    if (path === '/api/me/notifications') {
      return json({
        configured: answer.configured,
        offered: answer.offered,
        publicKey: answer.configured && answer.offered ? 'BPracticeKey' : null,
        devices: answer.devices ?? 0,
      });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/account/notifications']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <PhoneNotificationsPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { posts };
}

beforeEach(() => {
  device.state = 'off';
  device.subscribe.mockReset();
  device.unsubscribe.mockReset();
});

describe('PhoneNotificationsPage', () => {
  it('says plainly that notifications are not switched on when the practice has no key pair', async () => {
    mount({ configured: false, offered: false });
    expect(
      await screen.findByText('Phone notifications are not switched on for the practice yet.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull();
  });

  it('offers no switch to a role that has nothing to be told', async () => {
    mount({ configured: true, offered: false });
    expect(await screen.findByText('There are no notifications for your role yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull();
  });

  it('turns this browser on with the practice’s key, and says so', async () => {
    device.subscribe.mockResolvedValue(SUBSCRIBED);
    const { posts } = mount({ configured: true, offered: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }));
    expect(await screen.findByText('Notifications are on for this device.')).toBeTruthy();
    expect(device.subscribe).toHaveBeenCalledWith('BPracticeKey');
    expect(posts).toEqual([{ path: '/api/me/notifications/subscriptions', body: SUBSCRIBED }]);
  });

  it('turns it off again in one press', async () => {
    device.state = 'on';
    device.unsubscribe.mockResolvedValue(SUBSCRIBED.endpoint);
    const { posts } = mount({ configured: true, offered: true, devices: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off on this device' }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          path: '/api/me/notifications/subscriptions/remove',
          body: { endpoint: SUBSCRIBED.endpoint },
        },
      ]),
    );
    expect(await screen.findByRole('button', { name: 'Turn on for this device' })).toBeTruthy();
  });

  it('says when the browser has blocked notifications', async () => {
    device.subscribe.mockResolvedValue('blocked');
    mount({ configured: true, offered: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }));
    expect(
      await screen.findByText('Notifications are blocked for this site in the browser’s settings.'),
    ).toBeTruthy();
  });
});
