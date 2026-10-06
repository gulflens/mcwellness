// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketingResponse, NotificationsResponse } from '../../app/api/portal/schema';
import { AgreementsScreen } from '../../app/client/AgreementsScreen';
import { HomeScreen } from '../../app/client/HomeScreen';
import { AGREEMENTS, HOME } from './fixtures';
import { forgetLanguage, json, mountPortal } from './harness';

/**
 * The offers switch on Agreements and the notifications step on Home, in
 * both languages (the push memo's decisions 1 and 2; docs/SPEC/client-portal.md
 * sections 3.5 and 3.11). The phone is a stand-in: a service worker
 * registration with a push manager, and the browser's own permission
 * question, each answering what the test needs. Every key and address is
 * invented and opens nothing.
 */

const EN = '00000001-0000-4000-8000-0000000000a1';
const AR = '00000001-0000-4000-8000-0000000000a2';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic-device';
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
/** A P-256 point's shape in base64url; the phone stand-in never reads it. */
const PUBLIC_KEY = `B${'A'.repeat(86)}`;

function marketing(overrides: Partial<MarketingResponse> = {}): MarketingResponse {
  return {
    offered: true,
    state: 'never',
    since: null,
    wordings: { en: { id: EN, version: '1.0' }, ar: { id: AR, version: '1.0' } },
    ...overrides,
  };
}

function notifications(overrides: Partial<NotificationsResponse> = {}): NotificationsResponse {
  return { configured: true, offered: true, publicKey: PUBLIC_KEY, devices: 0, ...overrides };
}

const agreements = (answers: Record<string, () => Response> = {}) => ({
  '/api/portal/home': () => json(HOME),
  '/api/portal/agreements': () => json(AGREEMENTS),
  ...answers,
});

const home = (answers: Record<string, () => Response> = {}) => ({
  '/api/portal/home': () => json(HOME),
  ...answers,
});

/** The phone: a registration, a subscription or none, and a permission answer. */
function phone(options: { subscribed?: boolean; permission?: NotificationPermission } = {}) {
  let subscription: {
    endpoint: string;
    toJSON(): unknown;
    unsubscribe(): Promise<boolean>;
  } | null = null;
  const make = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }),
    unsubscribe: vi.fn(async () => {
      subscription = null;
      return true;
    }),
  });
  if (options.subscribed) subscription = make();
  const subscribe = vi.fn(async () => {
    subscription = make();
    return subscription;
  });
  const registration = {
    pushManager: { getSubscription: async () => subscription, subscribe },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => registration },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal(
    'Notification',
    Object.assign(class {}, {
      permission: options.permission ?? 'default',
      requestPermission: vi.fn(async () => options.permission ?? 'granted'),
    }),
  );
  return { subscribe };
}

function iphoneInSafari() {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The stand-ins are removed, so the next test starts from jsdom's own phone.
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'userAgent');
});
beforeEach(forgetLanguage);

describe('Agreements: the offers switch', () => {
  it('stands beside the wording, off, with the wording’s own sentence as its label', async () => {
    mountPortal(<AgreementsScreen />, {
      answers: agreements({ '/api/portal/marketing': () => json(marketing()) }),
    });
    expect(await screen.findByText('Offers on your phone')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: /I would like the practice to send me/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off. No offer is sent to you.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Read the wording' }).length).toBeGreaterThan(0);
  });

  it('turns off with one press, read right to left in Arabic', async () => {
    const { calls } = mountPortal(<AgreementsScreen />, {
      locale: 'ar',
      answers: agreements({
        '/api/portal/marketing': () =>
          json(marketing({ state: 'on', since: '2026-10-06T08:00:00.000Z' }), 201),
      }),
    });
    const toggle = await screen.findByRole('switch', { name: /أودّ أن يرسل إليّ المركز عروضه/ });
    expect(screen.getByText('العروض على هاتفك')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/portal/marketing/withdraw')).toBe(true),
    );
  });

  it('sends the wording read, by its id, when turned on', async () => {
    let state = marketing();
    const { calls } = mountPortal(<AgreementsScreen />, {
      answers: agreements({
        '/api/portal/marketing': () => {
          const answer = json(state);
          state = marketing({ state: 'on', since: '2026-10-06T08:00:00.000Z' });
          return answer;
        },
      }),
    });
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    const post = calls.find(
      (call) => call.path === '/api/portal/marketing' && call.init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.init?.body))).toEqual({ wordingId: EN });
    expect(screen.getByText(/On since/)).toBeTruthy();
  });

  it("shows a young person's own login nothing at all", async () => {
    mountPortal(<AgreementsScreen />, {
      answers: agreements({ '/api/portal/marketing': () => json(marketing({ offered: false })) }),
    });
    expect(await screen.findByText('Agreements')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Offers on your phone')).toBeNull());
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('keeps the rest of the screen when the switch cannot be read', async () => {
    mountPortal(<AgreementsScreen />, { answers: agreements() });
    expect(await screen.findByText('Agreements')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('Home: notifications on this phone', () => {
  it('offers the step and turns it on with one press, handing the server this phone', async () => {
    const device = phone();
    const { calls } = mountPortal(<HomeScreen />, {
      answers: home({
        '/api/portal/notifications': () => json(notifications()),
        '/api/portal/notifications/subscriptions': () => json(notifications({ devices: 1 }), 201),
      }),
    });
    const button = await screen.findByRole('button', { name: 'Turn on notifications' });
    expect(screen.getByText('Notifications on this phone')).toBeTruthy();
    fireEvent.click(button);
    expect(
      await screen.findByText('This phone receives the practice’s notifications.'),
    ).toBeTruthy();
    expect(device.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    const post = calls.find((call) => call.path === '/api/portal/notifications/subscriptions');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ endpoint: ENDPOINT, keys: KEYS });
  });

  it('turns it off on this phone, and asks the server to forget it', async () => {
    phone({ subscribed: true });
    const { calls } = mountPortal(<HomeScreen />, {
      locale: 'ar',
      answers: home({
        '/api/portal/notifications': () => json(notifications({ devices: 1 })),
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'إيقافها على هذا الهاتف' }));
    expect(await screen.findByRole('button', { name: 'تفعيل الإشعارات' })).toBeTruthy();
    const post = calls.find(
      (call) => call.path === '/api/portal/notifications/subscriptions/remove',
    );
    expect(JSON.parse(String(post?.init?.body))).toEqual({ endpoint: ENDPOINT });
  });

  it('says so when the phone has blocked them', async () => {
    phone({ permission: 'denied' });
    mountPortal(<HomeScreen />, {
      answers: home({ '/api/portal/notifications': () => json(notifications()) }),
    });
    expect(await screen.findByText(/blocked for this portal/)).toBeTruthy();
  });

  it('gives an iPhone in Safari the home-screen step, in one sentence and three steps', async () => {
    iphoneInSafari();
    mountPortal(<HomeScreen />, {
      answers: home({ '/api/portal/notifications': () => json(notifications()) }),
    });
    expect(
      await screen.findByText(
        'On an iPhone, notifications work once this portal is on your home screen.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Choose Add to Home Screen, then Add.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('gives the same step in Arabic, right to left', async () => {
    iphoneInSafari();
    mountPortal(<HomeScreen />, {
      locale: 'ar',
      answers: home({ '/api/portal/notifications': () => json(notifications()) }),
    });
    expect(
      await screen.findByText(
        'على هاتف آيفون، تعمل الإشعارات بعد إضافة هذه البوابة إلى الشاشة الرئيسية.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».')).toBeTruthy();
  });

  it('shows nothing when the practice has not configured push, or to a young person', async () => {
    phone();
    mountPortal(<HomeScreen />, {
      answers: home({
        '/api/portal/notifications': () =>
          json(notifications({ configured: false, offered: false, publicKey: null })),
      }),
    });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    expect(screen.queryByText('Notifications on this phone')).toBeNull();
    cleanup();
    mountPortal(<HomeScreen />, {
      answers: home({
        '/api/portal/notifications': () => json(notifications({ offered: false, publicKey: null })),
      }),
    });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    expect(screen.queryByText('Notifications on this phone')).toBeNull();
  });
});
