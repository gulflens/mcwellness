// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { OverviewTab } from './OverviewTab';
import { ADMIN, signedInProvider } from './testActors';

afterEach(cleanup);

const CLIENT_ID = '00000008-0000-4000-8000-0000000000f1';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record: ClientRecordResponse = {
  id: CLIENT_ID,
  mrn: 'MW-000045',
  givenName: 'Willow',
  familyName: 'Creek',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '1990-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: null,
  status: 'active',
  contacts: [],
  locations: [],
  consents: [],
  goals: [],
  concerns: [],
  health: null,
};

type Call = { url: string; init?: RequestInit };

function mount(
  status: ClientRecordResponse['status'],
  { mayWrite = true, statusReply = () => json({ id: CLIENT_ID }) } = {} as {
    mayWrite?: boolean;
    statusReply?: () => Response;
  },
) {
  const calls: Call[] = [];
  const onChanged = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ADMIN);
    calls.push({ url, init });
    if (url.endsWith('/erasure-requests')) return json({ requests: [] });
    if (url.endsWith('/status')) return statusReply();
    return json({ id: CLIENT_ID });
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <OverviewTab record={{ ...record, status }} onChanged={onChanged} mayWrite={mayWrite} />
    </AuthProviderBoundary>,
  );
  const statusCalls = () => calls.filter((c) => c.url === `/api/clients/${CLIENT_ID}/status`);
  return { statusCalls, onChanged };
}

function sent(call: Call | undefined): { to: string; reason: string | null } {
  const headers = new Headers(call?.init?.headers);
  return {
    to: (JSON.parse(String(call?.init?.body)) as { to: string }).to,
    reason: headers.get('x-reason'),
  };
}

const button = (name: string) => screen.queryByRole('button', { name });

describe('OverviewTab status moves', () => {
  it('offers Pause and Close to an active client, and nothing to reactivate', () => {
    mount('active');
    expect(button('Pause')).toBeTruthy();
    expect(button('Close')).toBeTruthy();
    expect(button('Reactivate')).toBeNull();
  });

  it('offers Reactivate and Close to a paused client', () => {
    mount('paused');
    expect(button('Reactivate')).toBeTruthy();
    expect(button('Close')).toBeTruthy();
    expect(button('Pause')).toBeNull();
  });

  it('offers only Reactivate to a closed client', () => {
    mount('closed');
    expect(button('Reactivate')).toBeTruthy();
    expect(button('Pause')).toBeNull();
    expect(button('Close')).toBeNull();
  });

  it('offers no status move to someone the status route would refuse', () => {
    mount('active', { mayWrite: false });
    expect(button('Pause')).toBeNull();
    expect(button('Close')).toBeNull();
  });

  it('offers no status move on an erased record', () => {
    mount('erased');
    for (const name of ['Pause', 'Close', 'Reactivate']) expect(button(name)).toBeNull();
  });

  it('pauses an active client in one press', async () => {
    const { statusCalls, onChanged } = mount('active');
    fireEvent.click(button('Pause')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent(statusCalls()[0])).toEqual({ to: 'paused', reason: null });
  });

  it('reactivates a paused client in one press, with no reason asked', async () => {
    const { statusCalls, onChanged } = mount('paused');
    fireEvent.click(button('Reactivate')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent(statusCalls()[0])).toEqual({ to: 'active', reason: null });
  });

  it('asks before closing, and closes a paused client once confirmed', async () => {
    const { statusCalls, onChanged } = mount('paused');
    fireEvent.click(button('Close')!);
    expect(statusCalls()).toHaveLength(0);
    fireEvent.click(button('Close record')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent(statusCalls()[0])).toEqual({ to: 'closed', reason: null });
  });

  it('lets a close be cancelled without sending anything', () => {
    const { statusCalls } = mount('active');
    fireEvent.click(button('Close')!);
    fireEvent.click(button('Cancel')!);
    expect(button('Close record')).toBeNull();
    expect(statusCalls()).toHaveLength(0);
  });

  it('will not reactivate a closed client without a reason, and sends the reason it is given', async () => {
    const { statusCalls, onChanged } = mount('closed');
    fireEvent.click(button('Reactivate')!);
    const confirm = button('Reactivate record') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'The family has asked to resume.' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(sent(statusCalls()[0])).toEqual({
      to: 'active',
      reason: 'The family has asked to resume.',
    });
  });

  it('says what to do when the record is not complete enough to reactivate', async () => {
    const { onChanged } = mount('paused', {
      statusReply: () => json({ error: 'incomplete', missing: ['location'] }, 400),
    });
    fireEvent.click(button('Reactivate')!);
    expect(
      await screen.findByText(
        'This record is missing something activation needs. Complete it, then reactivate.',
      ),
    ).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('says so when the status route refuses the person', async () => {
    mount('active', { statusReply: () => json({ error: 'forbidden' }, 403) });
    fireEvent.click(button('Pause')!);
    expect(
      await screen.findByText("You don't have permission to change this client's status."),
    ).toBeTruthy();
  });
});
