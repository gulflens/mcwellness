// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoidSessionDrawer } from '../../app/admin/schedule/VoidSessionDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { plainText } from './support';

/**
 * Voiding a visit logged from the records in error (trunk round 60,
 * docs/superpowers/specs/2026-09-23-void-logged-session-design.md "Screens"):
 * what the drawer says will happen, what it refuses to send, what it sends,
 * and what it says back. Synthetic throughout (.claude/rules/testing.md).
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

/** Wed 4 March 15:30 Dubai time is 11:30 UTC. Names from db/seed/names.ts. */
const visit = {
  id: '0000000a-0000-4000-8000-000000000101',
  windowStart: '2026-03-04T11:30:00.000Z',
  windowEnd: '2026-03-04T12:15:00.000Z',
  status: 'completed' as const,
  deliveryMode: 'home' as const,
  client: {
    id: '0000000a-0000-4000-8000-000000000001',
    givenName: 'Iris',
    familyName: 'Cliff',
    givenNameAr: null,
    familyNameAr: null,
  },
  practitioner: { id: '0000000a-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
  serviceType: { id: '0000000a-0000-4000-8000-000000000003', name: 'Standard session' },
  location: { id: '0000000a-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
  movedTo: null,
  sessionId: '0000000a-0000-4000-8000-000000000501',
  recordedFrom: 'records' as const,
  settledOutsideApp: false,
  sessionMinutes: 60,
};

function open(answer: () => Response, row = visit) {
  const posts: { url: string; headers: Headers; body: string }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return answer();
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const onVoided = vi.fn();
  const onClose = vi.fn();
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <VoidSessionDrawer appointment={row} onClose={onClose} onVoided={onVoided} />
    </AuthProviderBoundary>,
  );
  return { posts, onVoided, onClose };
}

const voidedAnswer = () =>
  new Response(
    JSON.stringify({
      sessionId: visit.sessionId,
      appointmentId: visit.id,
      creditRestored: true,
    }),
    { status: 200 },
  );

function giveReason(text: string) {
  fireEvent.change(screen.getByLabelText('Why'), { target: { value: text } });
}

describe('VoidSessionDrawer', () => {
  it('names the visit and says what voiding it does, the credit coming back', () => {
    open(voidedAnswer);
    expect(screen.getByRole('dialog', { name: 'Void this visit' })).toBeTruthy();
    expect(screen.getByText('Iris Cliff')).toBeTruthy();
    expect(screen.getByText('Wed 4 Mar 15:30–16:15', plainText)).toBeTruthy();
    expect(screen.getByText('The window is freed for the right visit.')).toBeTruthy();
    expect(screen.getByText('The session credit comes back to the household.')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
  });

  it('says nothing comes back for a visit settled before the app', () => {
    open(voidedAnswer, { ...visit, settledOutsideApp: true });
    expect(
      screen.getByText('Nothing comes back: the visit was settled before the app.'),
    ).toBeTruthy();
    expect(screen.queryByText('The session credit comes back to the household.')).toBeNull();
  });

  it('refuses to send without a reason', () => {
    const { posts } = open(voidedAnswer);
    const button = screen.getByRole('button', { name: 'Void' });
    expect(button.hasAttribute('disabled')).toBe(true);
    giveReason('   ');
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(posts).toEqual([]);
  });

  it('posts an empty JSON body with the reason as the request’s own, then hands back', async () => {
    const { posts, onVoided } = open(voidedAnswer);
    giveReason('Logged against the wrong household');
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(`/api/sessions/${visit.sessionId}/void`);
    expect(posts[0]!.body).toBe('{}');
    expect(posts[0]!.headers.get('content-type')).toBe('application/json');
    expect(posts[0]!.headers.get('x-reason')).toBe('Logged against the wrong household');
  });

  it('says why a conflict refused it, and stays open', async () => {
    for (const [code, sentence] of [
      ['not_a_records_row', 'Only a visit logged from the records can be voided.'],
      ['not_completed', 'This visit is not a completed one.'],
      ['already_voided', 'This visit has already been voided.'],
      ['session_in_use', 'A measurement or an invoice still names this visit; remove that first.'],
    ] as const) {
      const { onVoided } = open(
        () => new Response(JSON.stringify({ error: 'conflict', code }), { status: 409 }),
      );
      giveReason('Logged against the wrong household');
      fireEvent.click(screen.getByRole('button', { name: 'Void' }));
      expect(await screen.findByText(sentence)).toBeTruthy();
      expect(onVoided).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Void this visit' })).toBeTruthy();
      cleanup();
    }
  });

  it('asks to try again when anything else goes wrong', async () => {
    const { onVoided } = open(() => new Response('nope', { status: 500 }));
    giveReason('Logged against the wrong household');
    fireEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('The visit could not be voided. Try again.')).toBeTruthy();
    expect(onVoided).not.toHaveBeenCalled();
  });
});
