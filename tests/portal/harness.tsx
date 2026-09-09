// @vitest-environment jsdom
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import type { MeResponse } from '../../app/api/_middleware/actor-schema';
import { HomeScreen } from '../../app/client/HomeScreen';
import { MoneyScreen } from '../../app/client/MoneyScreen';
import { PortalLanguage } from '../../app/client/i18n';
import { PortalWithHome } from '../../app/client/PortalRoot';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * The portal's screens against a fake API, in either language
 * (docs/SPEC/client-portal.md section 13: "render from a fake API in English
 * and in Arabic with dir=rtl").
 *
 * Nothing here reaches a database or a network. `fetchImpl` answers whatever
 * the test hands it, so a screen's loading, empty, error and refused states are
 * all reachable — and every fixture is synthetic: names from
 * `db/seed/names.ts`, telephone numbers in the reserved block, addresses at
 * example.com and ids in the reserved shape (.claude/rules/testing.md).
 */

export const PORTAL_ACTOR: MeResponse = {
  userId: '00000001-0000-4000-8000-000000000001',
  displayName: 'Hazel Meadow',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  roles: ['client_contact'],
  capabilities: [],
  preferredLocale: 'en',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signInAs: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'a-token-that-unlocks-nothing',
  onChange: () => () => undefined,
};

export type Call = { path: string; init?: RequestInit };

/**
 * Renders one screen inside the portal's own shell, with the language settled.
 * `answers` maps a path prefix to what the fake API says; `/api/me` is answered
 * for you, because every screen sits behind the session boundary.
 */
export function mountPortal(
  screenElement: ReactElement,
  options: {
    locale?: 'en' | 'ar';
    answers?: Record<string, () => Response>;
    actor?: Partial<MeResponse>;
    /** What the sign-in provider can do beyond the development door's nothing. */
    provider?: Partial<AuthProvider>;
  } = {},
) {
  const calls: Call[] = [];
  const answers = options.answers ?? {};
  const actor = { ...PORTAL_ACTOR, ...options.actor };
  const signIn = { ...provider, ...options.provider } as AuthProvider;

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === '/api/me') return json(actor);
    const match = Object.keys(answers)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    return match ? (answers[match] as () => Response)() : json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <AuthProviderBoundary provider={signIn} fetchImpl={fetchImpl}>
      <PortalLanguage initial={options.locale ?? 'en'}>
        <MemoryRouter>
          {/* The router's own composition, so a screen is tested inside the
              shell it actually renders in — Home's answer included. */}
          <PortalWithHome>{screenElement}</PortalWithHome>
        </MemoryRouter>
      </PortalLanguage>
    </AuthProviderBoundary>,
  );
  return { ...view, calls };
}

/**
 * The portal at one of its own paths, through the route table `app/shell/App.tsx`
 * builds: the shell as the layout element and the screens beneath it. This is
 * how a redirect is tested — `mountPortal` hands a screen to the shell directly,
 * so a `Navigate` inside one has nothing to redirect to.
 */
export function mountPortalAt(
  at: string,
  options: { locale?: 'en' | 'ar'; answers?: Record<string, () => Response> } = {},
) {
  const calls: Call[] = [];
  const answers = options.answers ?? {};

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === '/api/me') return json(PORTAL_ACTOR);
    const match = Object.keys(answers)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    return match ? (answers[match] as () => Response)() : json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <PortalLanguage initial={options.locale ?? 'en'}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/portal" element={<PortalWithHome />}>
              <Route index element={<HomeScreen />} />
              <Route path="money" element={<MoneyScreen />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </PortalLanguage>
    </AuthProviderBoundary>,
  );
  return { ...view, calls };
}

/** The same, for a page that has its own root and its own route parameters. */
export function mountPage(element: ReactElement, path: string, at: string) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init });
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  return { ...view, calls };
}

/** The browser's own storage, cleared between tests: the language is remembered in it. */
export function forgetLanguage(): void {
  try {
    window.localStorage.clear();
  } catch {
    // Nothing stored, nothing to forget.
  }
}
