// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { ConsentTab } from './ConsentTab';
import { GoalsTab } from './GoalsTab';
import { HealthTab } from './HealthTab';
import { LocationForm } from './LocationForm';
import { OverviewTab } from './OverviewTab';
import { ADMIN, signedInProvider } from './testActors';

afterEach(cleanup);

const CLIENT_ID = '00000008-0000-4000-8000-0000000000e1';
const CONTACT_ID = '00000008-0000-4000-8000-0000000000e2';
const CATEGORY_ID = '00000008-0000-4000-8000-0000000000e3';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record: ClientRecordResponse = {
  id: CLIENT_ID,
  mrn: 'MW-000044',
  givenName: 'Willow',
  familyName: 'Creek',
  givenNameAr: null,
  familyNameAr: null,
  dateOfBirth: '2015-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: null,
  status: 'lead',
  contacts: [
    {
      id: CONTACT_ID,
      givenName: 'Iris',
      familyName: 'Creek',
      givenNameAr: 'سوسن',
      familyNameAr: 'خور',
      relationship: 'mother',
      isLegalGuardian: true,
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000061',
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
  ],
  locations: [],
  consents: [],
  goals: [
    {
      id: '00000008-0000-4000-8000-0000000000e4',
      categoryId: CATEGORY_ID,
      categoryCode: 'sleep',
      description: 'Settling at bedtime without a long wind-down.',
      setAt: '2026-01-01T09:00:00+04:00',
      status: 'active',
      isPrimary: true,
    },
  ],
  concerns: [],
  health: null,
};

/** A standing health-data consent, the one thing the Health tab's form waits for. */
const HEALTH_CONSENT: ClientRecordResponse['consents'][number] = {
  id: '00000008-0000-4000-8000-0000000000e6',
  purpose: 'health_data',
  status: 'active',
  givenByContactId: CONTACT_ID,
  givenAt: '2026-09-14T09:00:00+04:00',
  withdrawnAt: null,
  expiresAt: null,
  method: 'app_signature',
  signatureDocumentId: null,
  textDocumentId: '00000008-0000-4000-8000-0000000000e7',
  wordingVersion: '1.1',
  wordingStatus: 'approved',
  witnessedByUserId: null,
  witnessedByName: null,
  withdrawalReason: null,
};
/** The agreement itself, whose version the answers are recorded against. */
const PARTICIPATION_CONSENT: ClientRecordResponse['consents'][number] = {
  ...HEALTH_CONSENT,
  id: '00000008-0000-4000-8000-0000000000e8',
  purpose: 'participation',
  wordingVersion: '1.2',
};
const ASKED: NonNullable<ClientRecordResponse['health']> = {
  id: '00000008-0000-4000-8000-0000000000e9',
  askedAt: '2026-09-14T09:00:00+04:00',
  wordingVersion: '1.1',
  seizures: false,
  seizuresNote: null,
  implantedDevice: false,
  implantedDeviceNote: null,
  headInjury: true,
  headInjuryNote: 'A fall in 2019, no lasting effect',
  pregnancy: false,
  pregnancyNote: null,
  medication: false,
  medicationNote: null,
  scalp: false,
  scalpNote: null,
};

function mount(node: React.ReactNode, calls: { url: string; init?: RequestInit }[] = []) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ADMIN);
    calls.push({ url, init });
    if (url.endsWith('/erasure-requests')) {
      // Overview carries the erasure section, which asks this on mount. No
      // request has been recorded for this client, which is the ordinary case.
      return json({ requests: [] });
    }
    if (url === '/api/clients/goal-categories') {
      return json({
        categories: [{ id: CATEGORY_ID, code: 'sleep', name: 'Sleep', nameAr: null }],
      });
    }
    return json({ id: CLIENT_ID });
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      {node}
    </AuthProviderBoundary>,
  );
  return calls;
}

describe('OverviewTab', () => {
  it('reads the demographics a person needs, and says what a lead still lacks', async () => {
    mount(<OverviewTab record={record} onChanged={vi.fn()} mayWrite />);
    // en-GB, not the stored ISO form, and the age named rather than left as a number.
    expect(await screen.findByText(/01\/04\/2015 \(age \d+\)/)).toBeTruthy();
    expect(screen.getByText('Female')).toBeTruthy();
    // The contact's own name leads, with the relationship after it (CR-07).
    expect(screen.getByText('Iris Creek (mother)')).toBeTruthy();
    expect(screen.getByText('+971500000061')).toBeTruthy();
    // A lead with no location and no consent cannot be activated, and is told so.
    expect(screen.getByText('A location with its pin set')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('offers no Activate to someone the status route would refuse', () => {
    mount(<OverviewTab record={record} onChanged={vi.fn()} mayWrite={false} />);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  // A real column (db/migrations/060_client.sql), read-only here: it decides
  // which language a household's consent wording and erasure letter come out
  // in (app/api/clients/consents.ts, app/api/clients/erasure.ts), and it was
  // briefly removed as a "placeholder" before being restored (round 43,
  // fix wave).
  it("shows a client's preferred language as text, not a control", async () => {
    mount(
      <OverviewTab record={{ ...record, preferredLocale: 'ar' }} onChanged={vi.fn()} mayWrite />,
    );
    expect(await screen.findByText('Arabic')).toBeTruthy();
    expect(screen.queryByLabelText(/preferred language/i)).toBeNull();
  });
});

describe('ConsentTab', () => {
  it("names a minor's guardian consent among what is needed, and says none is on file", async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={() => undefined} mayWrite />);
    // Born 2015: a minor, so the guardian's consent is required as well as
    // taking part, and both are named in plain words.
    expect(await screen.findByText("Guardian's consent for a child")).toBeTruthy();
    expect(screen.getByText('Participation')).toBeTruthy();
    expect(screen.getAllByText('Needed before this client can be activated').length).toBe(4);
    // The retired purposes are not listed on a record that has never held one:
    // the practice takes no photographs, does no research and sends no
    // marketing since 2026-09-09, and a screen offering all three invites
    // somebody to ask a household for something the practice does not want.
    expect(screen.queryByText('Photographs and video')).toBeNull();
    expect(screen.queryByText('Research')).toBeNull();
    expect(screen.queryByText('Marketing')).toBeNull();
    // All four purposes are required for this minor, so nothing is optional
    // and nothing says "Not recorded" without also saying it is needed.
    expect(screen.queryAllByText('Not recorded').length).toBe(0);
  });

  it('still shows a retired purpose when this household actually agreed to one', () => {
    // A household that agreed to photographs before 2026-09-09 agreed to them.
    // The practice no longer asks anybody, but a consent screen that hides an
    // agreement somebody gave is a screen that lies about them — and it is the
    // screen the withdrawal is taken from.
    const held: ClientRecordResponse = {
      ...record,
      consents: [
        {
          id: '00000008-0000-4000-8000-0000000000f1',
          purpose: 'photo_video',
          status: 'active',
          givenByContactId: record.contacts[0]!.id,
          givenAt: '2026-01-01T09:00:00+04:00',
          withdrawnAt: null,
          expiresAt: null,
          method: 'app_signature',
          signatureDocumentId: null,
          textDocumentId: '00000008-0000-4000-8000-0000000000f2',
          wordingVersion: '0.2-draft',
          wordingStatus: 'draft',
          witnessedByUserId: null,
          witnessedByName: null,
          withdrawalReason: null,
        },
      ],
    };
    mount(<ConsentTab clientId={CLIENT_ID} record={held} onChanged={() => undefined} mayWrite />);
    expect(screen.getByText('Photographs and video')).toBeTruthy();

    // Shown so it can be withdrawn — and only that. There is no way to take a
    // NEW photo consent, because there is no longer anything it would permit.
    // The four offered purposes each keep their button; this row has none.
    expect(screen.getAllByRole('button', { name: /^Record$/ })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });
});

describe('GoalsTab', () => {
  it('reads a goal by its category name and asks why before dropping one', async () => {
    const calls = mount(
      <GoalsTab
        clientId={CLIENT_ID}
        record={record}
        onChanged={vi.fn()}
        mayWrite
        mayWriteConcerns
      />,
    );
    expect(await screen.findByText('Sleep')).toBeTruthy();
    expect(screen.getByText('Settling at bedtime without a long wind-down.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'dropped' } });
    // Nothing is sent until a reason is given (client-record.md section 9).
    expect(await screen.findByLabelText('Why is this goal dropped?')).toBeTruthy();
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);

    fireEvent.change(screen.getByLabelText('Why is this goal dropped?'), {
      target: { value: 'The programme moved on to focus.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(new Headers(patch?.init?.headers).get('x-reason')).toBe(
      'The programme moved on to focus.',
    );
  });

  it('shows a goal to someone who may not change it, and no way to change it', async () => {
    mount(
      <GoalsTab
        clientId={CLIENT_ID}
        record={record}
        onChanged={vi.fn()}
        mayWrite={false}
        mayWriteConcerns={false}
      />,
    );
    expect(await screen.findByText('Settling at bedtime without a long wind-down.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add goal' })).toBeNull();
    expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true);
  });

  it('lists a concern beneath the goals, resolves it without a reason, and offers to add one', async () => {
    // A concern is the household's worry in their own words beside a category
    // (client-record.md section 4.6). Resolving it is not a sensitive act, so
    // no reason is asked for — unlike dropping a goal.
    const withConcern: ClientRecordResponse = {
      ...record,
      goals: [],
      concerns: [
        {
          id: '00000008-0000-4000-8000-0000000000e5',
          categoryId: CATEGORY_ID,
          categoryCode: 'sleep',
          description: 'Wakes at three most nights and cannot settle.',
          notedAt: '2026-09-14T09:00:00+04:00',
          status: 'open',
        },
      ],
    };
    const calls = mount(
      <GoalsTab
        clientId={CLIENT_ID}
        record={withConcern}
        onChanged={vi.fn()}
        mayWrite={false}
        mayWriteConcerns
      />,
    );
    expect(await screen.findByText('Wakes at three most nights and cannot settle.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Concerns' })).toBeTruthy();
    // An admin: may not set a goal, may take down a concern.
    expect(screen.queryByRole('button', { name: 'Add goal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add concern' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe(
      `/api/clients/${CLIENT_ID}/concerns/00000008-0000-4000-8000-0000000000e5`,
    );
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ status: 'resolved' });
    expect(screen.queryByLabelText(/Why/)).toBeNull();
  });

  it('posts a new concern as a category and the words beside it', async () => {
    const calls = mount(
      <GoalsTab
        clientId={CLIENT_ID}
        record={record}
        onChanged={vi.fn()}
        mayWrite={false}
        mayWriteConcerns
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add concern' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Category') as HTMLSelectElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: CATEGORY_ID } });
    fireEvent.change(screen.getByLabelText('What the household is worried about'), {
      target: { value: 'Struggles to wind down after school.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add concern' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(`/api/clients/${CLIENT_ID}/concerns`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      categoryId: CATEGORY_ID,
      description: 'Struggles to wind down after school.',
    });
  });
});

describe('HealthTab', () => {
  const INCOMPLETE = 'Answer every question. "We did not ask" is not the same as "no".';

  function answer(question: string, yes: boolean) {
    const group = screen.getByRole('group', { name: question });
    fireEvent.click(within(group).getByLabelText(yes ? 'Yes' : 'No'));
  }

  it('says not asked yet, and offers no form until the health-data consent stands', async () => {
    // The route refuses without the consent (409), so the tab does not let
    // somebody answer six questions to be told no at the end
    // (client-record.md section 4.6).
    mount(<HealthTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />);
    expect(await screen.findByText('Not asked yet.')).toBeTruthy();
    expect(screen.getByText(/health-data consent, which is not on file/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record the answers' })).toBeNull();
  });

  it('says one thing about an erased record, not two', async () => {
    // The erasure deletes the declarations outright (964); "not asked yet"
    // beneath "the answers went with it" would contradict it.
    mount(
      <HealthTab
        clientId={CLIENT_ID}
        record={{ ...record, status: 'erased' }}
        onChanged={vi.fn()}
        mayWrite
        erased
      />,
    );
    expect(await screen.findByText(/The health answers went with it/)).toBeTruthy();
    expect(screen.queryByText('Not asked yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
  });

  it('shows the answers to someone who may not record them, and nothing to press', async () => {
    const asked: ClientRecordResponse = { ...record, consents: [HEALTH_CONSENT], health: ASKED };
    mount(<HealthTab clientId={CLIENT_ID} record={asked} onChanged={vi.fn()} mayWrite={false} />);
    expect(await screen.findByText('A fall in 2019, no lasting effect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
    expect(screen.queryByText(/not on file/)).toBeNull();
  });

  it('records all six under a standing consent, and refuses a half-answered form', async () => {
    const consented: ClientRecordResponse = {
      ...record,
      consents: [HEALTH_CONSENT, PARTICIPATION_CONSENT],
    };
    const onChanged = vi.fn();
    // The route answers 201 to a recorded declaration, which the shared mount
    // helper (200 to everything) does not, and the tab reads the code.
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(ADMIN);
      calls.push({ url, init });
      return json({ id: CLIENT_ID }, init?.method === 'POST' ? 201 : 200);
    }) as unknown as typeof fetch;
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <HealthTab clientId={CLIENT_ID} record={consented} onChanged={onChanged} mayWrite />
      </AuthProviderBoundary>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Record the answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the answers' }));
    // "We did not ask" is not "no": nothing is sent with a question unanswered.
    expect(await screen.findByText(INCOMPLETE)).toBeTruthy();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);

    answer('Epilepsy or any seizure', true);
    fireEvent.change(screen.getByLabelText('Anything to note (optional)'), {
      target: { value: 'Two, as a child.' },
    });
    answer('A pacemaker or any implanted electrical device', false);
    answer('A head injury at any time', false);
    answer('Pregnancy', false);
    answer('Medication that affects mood, sleep or attention', false);
    answer('A skin condition or sensitivity on the scalp', false);
    fireEvent.click(screen.getByRole('button', { name: 'Save the answers' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe(`/api/clients/${CLIENT_ID}/health`);
    // All six, the one note, and the version of the agreement that asked.
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      seizures: true,
      seizuresNote: 'Two, as a child.',
      implantedDevice: false,
      headInjury: false,
      pregnancy: false,
      medication: false,
      scalp: false,
      wordingVersion: '1.2',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows the newest answers with their note, and offers to record a change', async () => {
    const asked: ClientRecordResponse = { ...record, consents: [HEALTH_CONSENT], health: ASKED };
    mount(<HealthTab clientId={CLIENT_ID} record={asked} onChanged={vi.fn()} mayWrite />);
    expect(await screen.findByText('A fall in 2019, no lasting effect')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Health answers' });
    expect(within(list).getAllByText('Yes')).toHaveLength(1);
    expect(within(list).getAllByText('No')).toHaveLength(5);
    expect(screen.getByText(/Asked on/).textContent).toContain('under agreement 1.1');
    expect(screen.getByRole('button', { name: 'Record a change' })).toBeTruthy();
  });

  it('tells the office to record the consent first when the route refuses', async () => {
    // The tab judged the consent standing (it was, a moment ago) and the
    // route judged it withdrawn: the route's word wins, in a sentence.
    const consented: ClientRecordResponse = { ...record, consents: [HEALTH_CONSENT] };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(ADMIN);
      if (init?.method === 'POST') {
        return json({ error: 'conflict', code: 'consent_required', requestId: 'r1' }, 409);
      }
      return json({ id: CLIENT_ID });
    }) as unknown as typeof fetch;
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <HealthTab clientId={CLIENT_ID} record={consented} onChanged={vi.fn()} mayWrite />
      </AuthProviderBoundary>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Record the answers' }));
    for (const question of [
      'Epilepsy or any seizure',
      'A pacemaker or any implanted electrical device',
      'A head injury at any time',
      'Pregnancy',
      'Medication that affects mood, sleep or attention',
      'A skin condition or sensitivity on the scalp',
    ]) {
      answer(question, false);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save the answers' }));
    expect(
      await screen.findByText("Record the household's health-data consent first."),
    ).toBeTruthy();
  });
});

describe('LocationForm', () => {
  it('will not save a new location without an emirate and a point, and names both', async () => {
    const calls = mount(<LocationForm clientId={CLIENT_ID} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(await screen.findByText('Choose an emirate.')).toBeTruthy();
    expect(screen.getByText('Set the entrance point, or use your current position.')).toBeTruthy();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('sends the point and the emirate once both are given', async () => {
    const calls = mount(<LocationForm clientId={CLIENT_ID} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Emirate'), { target: { value: 'DXB' } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '25.2048' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '55.2708' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      emirate: 'DXB',
      entranceLat: 25.2048,
      entranceLng: 55.2708,
      label: 'home',
    });
  });
});
