// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Testimonial } from '../../api/testimonials/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { ReviewsPage } from './ReviewsPage';

/**
 * The Reviews screen (docs/SPEC/testimonials.md section 5): three tables by
 * status, Approve and Decline on what is waiting, Move up, Move down and
 * Withdraw on what is published. Synthetic throughout: seed names, no way to
 * reach anybody.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const WAITING: Testimonial = {
  id: '0000000f-0000-4000-8000-000000000001',
  submittedAt: '2026-10-05T09:30:00.000Z',
  displayName: 'Hazel H.',
  context: 'Parent, Dubai',
  rating: 5,
  body: 'The home visits fitted around our week, and the team explained every step.',
  language: 'en',
  status: 'pending',
  decidedAt: null,
  decidedByName: null,
};
const FIRST: Testimonial = {
  ...WAITING,
  id: '0000000f-0000-4000-8000-000000000002',
  displayName: 'Basil V.',
  context: null,
  rating: 4,
  status: 'approved',
  decidedAt: '2026-10-04T08:00:00.000Z',
  decidedByName: 'Iris Harbour',
};
const SECOND: Testimonial = {
  ...FIRST,
  id: '0000000f-0000-4000-8000-000000000003',
  displayName: 'Rowan M.',
};
const ARABIC: Testimonial = {
  ...FIRST,
  id: '0000000f-0000-4000-8000-000000000004',
  displayName: 'ريحان و.',
  body: 'زيارات منزلية منظمة وفريق واضح في كل خطوة من البرنامج.',
  language: 'ar',
};
const DECLINED: Testimonial = {
  ...WAITING,
  id: '0000000f-0000-4000-8000-000000000005',
  displayName: 'Iris C.',
  status: 'declined',
  decidedAt: '2026-10-05T10:00:00.000Z',
  decidedByName: 'Iris Harbour',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(options: { failList?: boolean; failAction?: boolean } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  let rows: Testimonial[] = [WAITING, FIRST, SECOND, ARABIC, DECLINED];
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
    if (url.startsWith('/api/testimonials?')) {
      if (options.failList) return json({ error: 'internal' }, 500);
      const status = new URLSearchParams(url.split('?')[1]).get('status');
      return json({
        testimonials: rows.filter((row) => row.status === status),
        counts: {
          pending: rows.filter((row) => row.status === 'pending').length,
          approved: rows.filter((row) => row.status === 'approved').length,
          declined: rows.filter((row) => row.status === 'declined').length,
        },
      });
    }
    if (init?.method === 'POST') {
      // As the API does: a POST that is not JSON never reaches a route.
      const type = new Headers(init.headers).get('content-type') ?? '';
      if (!type.toLowerCase().startsWith('application/json')) {
        return json({ error: 'unsupported_media_type' }, 415);
      }
      const body = init.body ? (JSON.parse(String(init.body)) as unknown) : null;
      posts.push({ url, body });
      if (options.failAction) return json({ error: 'internal' }, 500);
      const [, , , id, action] = url.split('/');
      if (action === 'approve' || action === 'decline' || action === 'withdraw') {
        rows = rows.map((row) =>
          row.id === id
            ? {
                ...row,
                status: action === 'approve' ? 'approved' : 'declined',
                decidedAt: '2026-10-06T08:00:00.000Z',
                decidedByName: 'Iris Harbour',
              }
            : row,
        );
        return json({ ok: true });
      }
      if (action === 'move') {
        const direction = (body as { direction: 'up' | 'down' }).direction;
        const index = rows.findIndex((row) => row.id === id);
        const other = direction === 'up' ? index - 1 : index + 1;
        const next = [...rows];
        [next[index], next[other]] = [next[other]!, next[index]!];
        rows = next;
        return json({ ok: true, moved: true });
      }
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <MemoryRouter>
      <AuthProviderBoundary provider={provider}>
        <ReviewsPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { posts, fetchImpl };
}

describe('ReviewsPage', () => {
  it('opens on what is waiting, with the counts of all three on the tabs', async () => {
    mount();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Hazel H.')).toBeTruthy();
    expect(within(table).getByText('Parent, Dubai')).toBeTruthy();
    expect(within(table).getByText('5 of 5')).toBeTruthy();
    expect(within(table).queryByText('Basil V.')).toBeNull();
    const tabs = screen.getByRole('navigation', { name: 'Reviews by status' });
    expect(within(tabs).getByRole('button', { name: 'Pending (1)' })).toBeTruthy();
    expect(within(tabs).getByRole('button', { name: 'Approved (3)' })).toBeTruthy();
    expect(within(tabs).getByRole('button', { name: 'Declined (1)' })).toBeTruthy();
  });

  it('approves a waiting review, and it leaves the table for Approved', async () => {
    const { posts } = mount();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Approve Hazel H.' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.url).toBe(`/api/testimonials/${WAITING.id}/approve`);
    await waitFor(() => expect(screen.queryByText('Hazel H.')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Approved (4)' })).toBeTruthy();
  });

  it('declines a waiting review', async () => {
    const { posts } = mount();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Decline Hazel H.' }));
    await waitFor(() => expect(posts[0]?.url).toBe(`/api/testimonials/${WAITING.id}/decline`));
  });

  it('lists what is published in the website’s order, with its language and who approved it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approved (3)' }));
    const table = await screen.findByRole('table');
    await within(table).findByText('Basil V.');
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(names).toEqual(['Basil V.', 'Rowan M.', 'ريحان و.']);
    expect(within(table).getAllByText('English')).toHaveLength(2);
    expect(within(table).getByText('Arabic')).toBeTruthy();
    // The words are shown in their own direction, whatever the console's.
    const arabic = within(table).getByText(ARABIC.body);
    expect(arabic.getAttribute('dir')).toBe('auto');
    expect(arabic.getAttribute('lang')).toBe('ar');
  });

  it('moves a published review within its own language, and cannot move past either end', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approved (3)' }));
    const table = await screen.findByRole('table');
    await within(table).findByText('Basil V.');
    // First in English: nowhere to go up. Last in English: nowhere to go down.
    expect(
      (within(table).getByRole('button', { name: 'Move Basil V. up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(table).getByRole('button', { name: 'Move Rowan M. down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // The only Arabic review is both first and last of its own list.
    expect(
      (within(table).getByRole('button', { name: 'Move ريحان و. up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(within(table).getByRole('button', { name: 'Move Basil V. down' }));
    await waitFor(() =>
      expect(posts).toEqual([
        { url: `/api/testimonials/${FIRST.id}/move`, body: { direction: 'down' } },
      ]),
    );
  });

  it('asks before withdrawing, and withdraws when confirmed', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approved (3)' }));
    const table = await screen.findByRole('table');
    await within(table).findByText('Basil V.');
    fireEvent.click(within(table).getByRole('button', { name: 'Withdraw Basil V.' }));
    expect(posts).toEqual([]);
    expect(within(table).getByText('Take it off the website?')).toBeTruthy();
    fireEvent.click(within(table).getByRole('button', { name: 'Cancel' }));
    expect(within(table).queryByText('Take it off the website?')).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: 'Withdraw Basil V.' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() =>
      expect(posts).toEqual([{ url: `/api/testimonials/${FIRST.id}/withdraw`, body: {} }]),
    );
    expect(await screen.findByRole('button', { name: 'Declined (2)' })).toBeTruthy();
  });

  it('says how long a declined review is kept', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Declined (1)' }));
    expect(await screen.findByText('Iris C.')).toBeTruthy();
    expect(
      screen.getByText(
        'A declined or withdrawn review is deleted 30 days after the decision. It is never shown on the website.',
      ),
    ).toBeTruthy();
  });

  it('says so when the list cannot be loaded', async () => {
    mount({ failList: true });
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('says so when a decision fails, and leaves the review where it was', async () => {
    mount({ failAction: true });
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Approve Hazel H.' }));
    expect(await screen.findByText('That could not be done. Reload and try again.')).toBeTruthy();
    expect(within(table).getByText('Hazel H.')).toBeTruthy();
  });
});
