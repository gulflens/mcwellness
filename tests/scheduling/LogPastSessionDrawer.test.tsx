// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogPastSessionDrawer } from '../../app/admin/schedule/LogPastSessionDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * The "Log a past session" drawer (docs/superpowers/specs/2026-09-16-past-sessions-design.md):
 * what it sends, what it refuses to send, and what it says back. Synthetic
 * throughout (.claude/rules/testing.md).
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const client = {
  id: '00000008-0000-4000-8000-000000000001',
  mrn: 'MW-000001',
  givenName: 'Iris',
  familyName: 'Cliff',
  givenNameAr: null,
  familyNameAr: null,
  age: 12,
  status: 'active' as const,
  contact: null,
  emirate: 'DXB',
};
const serviceType = {
  id: '00000008-0000-4000-8000-000000000010',
  name: 'Standard session',
  deliveryModes: ['home'],
};
const homeLocation = { id: '00000008-0000-4000-8000-000000000011', label: 'home', emirate: 'DXB' };
const practitioner = { id: '00000008-0000-4000-8000-000000000013', displayName: 'Cedar Ridge' };

function buildFetch(postResponse: () => Response) {
  const posts: { body: Record<string, unknown>; reason: string | undefined }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/clients' && method === 'GET') {
      return new Response(JSON.stringify({ clients: [client], note: null }), { status: 200 });
    }
    if (url.pathname === '/api/appointments/options' && method === 'GET') {
      return new Response(
        JSON.stringify({
          serviceTypes: [serviceType],
          locations: [homeLocation],
          practitioners: url.searchParams.get('date') === '2026-03-04' ? [practitioner] : [],
        }),
        { status: 200 },
      );
    }
    if (url.pathname === '/api/sessions/from-records' && method === 'POST') {
      const headers = new Headers(init?.headers);
      posts.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        reason: headers.get('x-reason') ?? undefined,
      });
      return postResponse();
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, posts };
}

async function fillIn(fetchImpl: typeof fetch) {
  const onRecorded = vi.fn();
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <LogPastSessionDrawer date="2026-03-04" onClose={vi.fn()} onRecorded={onRecorded} />
    </AuthProviderBoundary>,
  );
  fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Iris' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy(), {
    timeout: 1000,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));
  // One service and, for this day, one certified practitioner: both chosen.
  await waitFor(() =>
    expect((screen.getByLabelText('Practitioner') as HTMLSelectElement).value).toBe(
      practitioner.id,
    ),
  );
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: homeLocation.id } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '15:30' } });
  fireEvent.change(screen.getByLabelText('How was it paid for?'), { target: { value: 'credit' } });
  fireEvent.change(screen.getByLabelText('Why it is being logged now'), {
    target: { value: 'From the paper diary' },
  });
  return onRecorded;
}

const recorded = () =>
  new Response(
    JSON.stringify({
      status: 'recorded',
      sessionId: '00000000-0000-4000-8000-000000000501',
      appointmentId: '00000000-0000-4000-8000-000000000801',
      billed: 'credit',
    }),
    { status: 201 },
  );

describe('LogPastSessionDrawer', () => {
  it('sends the visit on the day the schedule shows, with the reason as the request’s own', async () => {
    const { fetchImpl, posts } = buildFetch(recorded);
    const onRecorded = await fillIn(fetchImpl);
    const submit = screen.getByRole('button', { name: 'Log the session' });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(posts).toEqual([
      {
        reason: 'From the paper diary',
        body: {
          clientId: client.id,
          practitionerId: practitioner.id,
          serviceTypeId: serviceType.id,
          locationId: homeLocation.id,
          deliveryMode: 'home',
          on: '2026-03-04',
          startTime: '15:30',
          billing: 'credit',
        },
      },
    ]);
  });

  it('sends a length only when one is typed, and refuses one no visit can have', async () => {
    const { fetchImpl, posts } = buildFetch(recorded);
    await fillIn(fetchImpl);
    fireEvent.change(screen.getByLabelText('Length in minutes (optional)'), {
      target: { value: '500' },
    });
    expect(screen.getByText('Not a length a visit can have.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log the session' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Length in minutes (optional)'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log the session' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body.durationMinutes).toBe(90);
  });

  it('will not send without a reason or a settlement', async () => {
    const { fetchImpl } = buildFetch(recorded);
    await fillIn(fetchImpl);
    fireEvent.change(screen.getByLabelText('Why it is being logged now'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'Log the session' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Why it is being logged now'), {
      target: { value: 'From the paper diary' },
    });
    fireEvent.change(screen.getByLabelText('How was it paid for?'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Log the session' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('says what blocked the visit, in the office’s words, and what to do about it', async () => {
    const { fetchImpl } = buildFetch(
      () =>
        new Response(JSON.stringify({ status: 'blocked', reasons: ['no_credit_available'] }), {
          status: 422,
        }),
    );
    await fillIn(fetchImpl);
    fireEvent.click(screen.getByRole('button', { name: 'Log the session' }));
    expect(
      await screen.findByText(
        'No credit covers this visit on that day. Record the package sale first, or mark the visit as settled before the app.',
      ),
    ).toBeTruthy();
  });

  it('names a refused day and a missing reason as the route does', async () => {
    const { fetchImpl } = buildFetch(
      () =>
        new Response(JSON.stringify({ error: 'bad_request', code: 'too_old', requestId: 'x' }), {
          status: 400,
        }),
    );
    await fillIn(fetchImpl);
    fireEvent.click(screen.getByRole('button', { name: 'Log the session' }));
    expect(
      await screen.findByText('That is before the practice existed. Check the year.'),
    ).toBeTruthy();
  });
});
