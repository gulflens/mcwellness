// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import { CancelAppointmentDrawer } from '../../app/admin/schedule/CancelAppointmentDrawer';
import { MoveAppointmentDrawer } from '../../app/admin/schedule/MoveAppointmentDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The two drawers that change a visit already promised to a household
 * (docs/SPEC/scheduling-manual.md sections 2 and 3).
 *
 * What is proved here: the move sends the window a coordinator typed and the
 * reason they gave, and names a clash in this screen's own words rather than
 * the server's; and the cancel names the consequence — a call-out fee —
 * before the person confirms, and reports what actually happened afterwards.
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md);
// names come from db/seed/names.ts, the one list every invented person here
// is named from.
const APPOINTMENT: AppointmentRow = {
  id: '0000000a-0000-4000-8000-000000000101',
  // 09:00–09:45 in the practice's own zone, on a fixed day.
  windowStart: '2026-09-10T05:00:00.000Z',
  windowEnd: '2026-09-10T05:45:00.000Z',
  status: 'confirmed',
  deliveryMode: 'home',
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
};

/** A visit far enough out that the practice's notice period is not in play. */
const WELL_AHEAD: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000102',
  windowStart: new Date(Date.now() + 96 * 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() + 96 * 3_600_000 + 45 * 60_000).toISOString(),
};

/** One the practitioner is standing at: the window opened an hour ago. */
const AT_THE_DOOR: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000104',
  windowStart: new Date(Date.now() - 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() - 3_600_000 + 45 * 60_000).toISOString(),
};

/**
 * And one the household has never been told about, three hours out — well
 * inside the practice's notice period, and costing them nothing all the same
 * (docs/CHANGE-REQUESTS/qa-01.md item 5).
 */
const UNTOLD: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000105',
  status: 'proposed',
  windowStart: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() + 3 * 3_600_000 + 45 * 60_000).toISOString(),
};

/** And one inside it. */
const IMMINENT: AppointmentRow = {
  ...APPOINTMENT,
  id: '0000000a-0000-4000-8000-000000000103',
  windowStart: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  windowEnd: new Date(Date.now() + 3 * 3_600_000 + 45 * 60_000).toISOString(),
};

/** `apiFetch` normalises whatever a caller passes into a `Headers`
 * (app/shell/auth/AuthContext.tsx), so this is how a test reads one back. */
function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function mount(node: React.ReactNode, fetchImpl: typeof fetch) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter>{node}</MemoryRouter>
    </AuthProviderBoundary>,
  );
}

/**
 * Waits for the drawer to have read the practice's notice period.
 *
 * The action is deliberately closed off until it has: a cancellation that
 * might silently cost a household a session is not one to allow while the
 * screen cannot say which it is. So a test that clicks before this has
 * happened is testing a disabled button.
 */
async function policyRead() {
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}

function settingsAnd(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/appointments/settings')) {
      return new Response(JSON.stringify({ noticeHours: 24, unfitFeeFils: 15000 }), {
        status: 200,
      });
    }
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe('MoveAppointmentDrawer', () => {
  it('opens on the window the household was already promised', async () => {
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    // Twice: once on the context line above the fields, naming the day and
    // the window the household was promised, and once as the start-time
    // field's own hint. The day itself is asserted through the date field
    // below rather than through a formatted month name, which is the one
    // thing here that a change of locale data could move.
    expect(screen.getAllByText(/09:00–09:45/)).toHaveLength(2);
    expect(screen.getByText(/Iris Cliff/)).toBeTruthy();
    expect((screen.getByLabelText('New date') as HTMLInputElement).value).toBe('2026-09-10');
    expect((screen.getByLabelText('New start time') as HTMLInputElement).value).toBe('09:00');
    // Moving a visit tells nobody — not the household, and not the
    // practitioner driving there — and the screen says so rather than leaving
    // it to be discovered.
    expect(
      screen.getByText(
        /The household still has to be told the new window, and the practitioner sees it on their next Today\./,
      ),
    ).toBeTruthy();
  });

  it('will not move a visit to the time it already has, or without a reason', () => {
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    const submit = screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Choose a different time first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    // A new time, and still no reason — and the screen says which, rather than
    // leaving a grey button to be clicked twice and given up on.
    expect(
      (screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Say why it is moving first.')).toBeTruthy();
    expect(screen.queryByText('Choose a different time first.')).toBeNull();

    fireEvent.change(screen.getByLabelText('Why is it moving?'), {
      target: { value: 'The family asked for the afternoon.' },
    });
    expect(
      (screen.getByRole('button', { name: 'Move appointment' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    // And nothing is missing any more.
    expect(screen.queryByText('Say why it is moving first.')).toBeNull();
  });

  it('sends the new window and carries the reason on the request, not in the body', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = settingsAnd((url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          appointment: { ...APPOINTMENT, id: '0000000a-0000-4000-8000-000000000201' },
          movedFrom: {
            id: APPOINTMENT.id,
            windowStart: APPOINTMENT.windowStart,
            windowEnd: APPOINTMENT.windowEnd,
          },
        }),
        { status: 201 },
      );
    });
    const onMoved = vi.fn();
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={onMoved}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), {
      target: { value: 'The family asked for the afternoon.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move appointment' }));

    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    const request = seen.find((entry) => entry.url.endsWith('/move'));
    expect(request?.url).toBe(`/api/appointments/${APPOINTMENT.id}/move`);
    expect(headerOf(request?.init, 'x-reason')).toBe('The family asked for the afternoon.');
    // 14:00 in the practice's own zone, sent as the instant it is.
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      windowStart: '2026-09-10T10:00:00.000Z',
    });
  });

  it('names a clash in this screen’s own words, with the way out', async () => {
    const fetchImpl = settingsAnd(
      () =>
        new Response(
          JSON.stringify({
            error: 'conflict',
            issues: [
              {
                code: 'practitioner_overlap',
                message: 'This practitioner is already booked close to this time.',
                conflictsWithAppointmentId: null,
              },
            ],
            requestId: null,
          }),
          { status: 409 },
        ),
    );
    mount(
      <MoveAppointmentDrawer
        appointment={APPOINTMENT}
        onClose={() => undefined}
        onMoved={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Why is it moving?'), { target: { value: 'A clash.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move appointment' }));

    expect(
      await screen.findByText(
        'This practitioner is already booked close to this time. Choose a different time or practitioner.',
      ),
    ).toBeTruthy();
  });
});

describe('CancelAppointmentDrawer', () => {
  it('says there is no fee when the notice period is not in play', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={WELL_AHEAD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      await screen.findByText(/outside the practice’s 24 hours’ notice, so there is no fee/),
    ).toBeTruthy();
    // Calling a visit off tells nobody either, and this drawer says so just as
    // the Move drawer does.
    expect(
      screen.getByText(
        /The household still has to be told the visit is off, and the practitioner sees it on their next Today\./,
      ),
    ).toBeTruthy();
  });

  it('takes nothing from a household that was never told, however close the window', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={UNTOLD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      await screen.findByText(
        /The household has not been told about this visit yet, so calling it off costs them nothing/,
      ),
    ).toBeTruthy();
    // And not the sentence the same visit would have shown an hour ago: that
    // one says a session is used, which was the defect.
    expect(screen.queryByText(/A call-out fee of AED/)).toBe(null);
    expect(screen.queryByText(/hours’ notice, so there is no fee/)).toBe(null);
    // Nothing to tell them afterwards either.
    expect(
      screen.getByText(/There is nothing to tell the household: this visit was never announced/),
    ).toBeTruthy();
  });

  it('does not offer "the family called it off" about a visit the family has never heard of', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={UNTOLD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    const reason = (await screen.findByLabelText('Reason')) as HTMLSelectElement;
    const offered = [...reason.options].map((option) => option.textContent);
    expect(offered).toEqual(['The practice called it off']);
    expect(reason.value).toBe('practice_request');
  });

  it('offers both of them again once the household has been told', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    const reason = (await screen.findByLabelText('Reason')) as HTMLSelectElement;
    expect([...reason.options].map((option) => option.textContent)).toEqual([
      'The family called it off',
      'The practice called it off',
      'The visit could not go ahead at the door',
    ]);
  });

  it('names the consequence before the coordinator confirms', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    // The founder's rule of 2026-09-04, in the sentence a coordinator reads
    // before they act: a fee, and never a session.
    expect(
      await screen.findByText(/This is inside the practice's 24 hours' notice\./),
    ).toBeTruthy();
    expect(
      await screen.findByText(/A call-out fee of AED 150\.00 applies; no session is taken\./),
    ).toBeTruthy();
  });

  it('says a visit the practice calls off itself costs the family nothing', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    await screen.findByText(/A call-out fee of AED 150\.00 applies/);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'practice_request' } });
    expect(
      await screen.findByText(
        /it costs the family nothing: the practice is calling it off\. No session is taken and no fee is charged\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/A call-out fee of AED/)).toBeNull();
  });

  it('charges the same fee for a visit that could not go ahead at the door, however much notice there was', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={AT_THE_DOOR}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    await screen.findByText(/inside the practice's 24 hours' notice/);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'unfit_to_attend' } });
    expect(
      await screen.findByText(
        /A visit that cannot go ahead once the practitioner has arrived counts as late whatever notice was given\./,
      ),
    ).toBeTruthy();
    // The practice's own figure, formatted by the one money formatter, and
    // the same one an ordinary late cancellation carries.
    expect(
      screen.getByText(/A call-out fee of AED 150\.00 applies; no session is taken\./),
    ).toBeTruthy();
  });

  it('refuses "could not go ahead at the door" for a visit nobody has driven to yet', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={WELL_AHEAD}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    await screen.findByText(/outside the practice’s 24 hours’ notice/);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'unfit_to_attend' } });
    // Said before anything is typed, and the action closed off with it: the
    // route and the database refuse this too, and being told at the end would
    // be being told too late.
    expect(
      await screen.findByText(
        /A visit can only be recorded as unable to go ahead once its arrival window has opened\./,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'No answer.' } });
    expect(
      (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // And the fee is not named for a thing that cannot be recorded.
    expect(screen.queryByText(/A call-out fee of AED/)).toBeNull();
  });

  it('sends the chosen reason and reports the fee that was charged', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = settingsAnd((url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          id: IMMINENT.id,
          status: 'cancelled_late',
          reason: 'client_request',
          noticeHours: 24,
          callOutFeeNetFils: 15000,
          callOutFeeVatFils: 0,
          callOutFeeGrossFils: 15000,
          feeInvoiceId: '0000000a-0000-4000-8000-000000000301',
        }),
        { status: 200 },
      );
    });
    const onCancelled = vi.fn();
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={onCancelled}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'The child is unwell.' },
    });
    await policyRead();
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    expect(
      await screen.findByText(
        /A call-out fee of AED 150\.00 is on the client’s account, and no session was taken\./,
      ),
    ).toBeTruthy();
    // The same figure the drawer named before the act, and no talk of VAT: the
    // practice is not registered, so the net fee is the whole of it.
    expect(screen.queryByText(/including VAT/)).toBeNull();
    expect(onCancelled).toHaveBeenCalled();
    const request = seen.find((entry) => entry.url.endsWith('/cancel'));
    expect(request?.url).toBe(`/api/appointments/${IMMINENT.id}/cancel`);
    expect(headerOf(request?.init, 'x-reason')).toBe('The child is unwell.');
    expect(JSON.parse(String(request?.init?.body))).toEqual({ reason: 'client_request' });
    // The way back is offered, and never a route path on the face of a screen.
    expect(screen.getByRole('link', { name: 'Open Billing' })).toBeTruthy();
  });

  it('names the gross figure, and says so, once the practice charges VAT', async () => {
    // Every price this practice publishes is net and VAT is added on top at
    // write time (migration 406). So a registered practice's fee is AED 157.50
    // where the drawer said AED 150.00 a moment earlier, and the difference is
    // named rather than left to look like a price that moved (design review of
    // this pull request).
    const fetchImpl = settingsAnd(
      () =>
        new Response(
          JSON.stringify({
            id: IMMINENT.id,
            status: 'cancelled_late',
            reason: 'client_request',
            noticeHours: 24,
            callOutFeeNetFils: 15000,
            callOutFeeVatFils: 750,
            callOutFeeGrossFils: 15750,
            feeInvoiceId: '0000000a-0000-4000-8000-000000000301',
          }),
          { status: 200 },
        ),
    );
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'The child is unwell.' },
    });
    await policyRead();
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    expect(
      await screen.findByText(
        /A call-out fee of AED 157\.50, including VAT, is on the client’s account/,
      ),
    ).toBeTruthy();
  });

  it('waives the fee in one click, with the sentence already written', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = settingsAnd((url, init) => {
      seen.push({ url, init });
      if (url.includes('/waiver')) {
        return new Response(
          JSON.stringify({
            waivedInvoiceId: '0000000a-0000-4000-8000-000000000301',
            waivedGrossFils: 15000,
          }),
          { status: 201 },
        );
      }
      return new Response(
        JSON.stringify({
          id: IMMINENT.id,
          status: 'cancelled_late',
          reason: 'client_request',
          noticeHours: 24,
          callOutFeeNetFils: 15000,
          callOutFeeVatFils: 0,
          callOutFeeGrossFils: 15000,
          feeInvoiceId: '0000000a-0000-4000-8000-000000000301',
        }),
        { status: 200 },
      );
    });
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'The practice moved it at the last minute.' },
    });
    await policyRead();
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Waive the fee' }));
    expect(
      await screen.findByText('The call-out fee has been waived. The client owes nothing for it.'),
    ).toBeTruthy();

    // Addressed to the charge that was actually made, and carrying the reason
    // the coordinator had already written — the one moment they both know a
    // waiver is wanted and have said why.
    const waiver = seen.find((entry) => entry.url.includes('/waiver'));
    expect(waiver?.url).toBe('/api/billing/invoices/0000000a-0000-4000-8000-000000000301/waiver');
    expect(JSON.parse(String(waiver?.init?.body))).toEqual({
      reason: 'The practice moved it at the last minute.',
    });
    expect(headerOf(waiver?.init, 'x-reason')).toBe('The practice moved it at the last minute.');
    // And the offer is gone once it is done.
    expect(screen.queryByRole('button', { name: 'Waive the fee' })).toBeNull();
  });

  it('says plainly when waiving is not this person’s to do', async () => {
    const fetchImpl = settingsAnd((url) => {
      if (url.includes('/waiver')) {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
      }
      return new Response(
        JSON.stringify({
          id: IMMINENT.id,
          status: 'cancelled_late',
          reason: 'client_request',
          noticeHours: 24,
          callOutFeeNetFils: 15000,
          callOutFeeVatFils: 0,
          callOutFeeGrossFils: 15000,
          feeInvoiceId: '0000000a-0000-4000-8000-000000000301',
        }),
        { status: 200 },
      );
    });
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'A genuine emergency at home.' },
    });
    await policyRead();
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Waive the fee' }));
    // A lead practitioner may call a visit off and may not forgive the charge.
    expect(
      await screen.findByText(/Waiving a charge is the owner’s, an admin’s or finance’s\./),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Billing' })).toBeTruthy();
  });

  it('does not claim a charge when nothing was charged', async () => {
    const fetchImpl = settingsAnd(
      () =>
        new Response(
          JSON.stringify({
            id: IMMINENT.id,
            status: 'cancelled_late',
            reason: 'client_request',
            noticeHours: 24,
            callOutFeeNetFils: null,
            callOutFeeVatFils: null,
            callOutFeeGrossFils: null,
            feeInvoiceId: null,
          }),
          { status: 200 },
        ),
    );
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'No answer.' } });
    await policyRead();
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    expect(
      await screen.findByText(/Nothing was charged for it, and no session was taken\./),
    ).toBeTruthy();
    expect(screen.queryByText(/A call-out fee of AED/)).toBeNull();
  });

  it('will not let a visit be called off while the consequence is unknown', async () => {
    // The practice's notice period cannot be read, so the drawer cannot say
    // whether this costs the household a fee. Saying nothing and letting
    // it happen anyway is the one outcome that is not acceptable.
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      fetchImpl,
    );
    expect(await screen.findByText(/The practice’s notice period could not be read/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'No answer.' } });
    expect(
      (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('will not call a visit off without saying what happened', async () => {
    mount(
      <CancelAppointmentDrawer
        appointment={IMMINENT}
        onClose={() => undefined}
        onCancelled={() => undefined}
      />,
      settingsAnd(() => new Response('not found', { status: 404 })),
    );
    expect(
      (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
