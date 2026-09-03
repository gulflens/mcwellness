// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { ClientRecordResponse } from '../../api/clients/record-schema';
import { ConsentTab } from './ConsentTab';
import { GoalsTab } from './GoalsTab';
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
};

function mount(node: React.ReactNode, calls: { url: string; init?: RequestInit }[] = []) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ADMIN);
    calls.push({ url, init });
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
    expect(screen.getByText('A location with a verified pin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('offers no Activate to someone the status route would refuse', () => {
    mount(<OverviewTab record={record} onChanged={vi.fn()} mayWrite={false} />);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });
});

describe('ConsentTab', () => {
  it("names a minor's guardian consent among what is needed, and says none is on file", async () => {
    mount(<ConsentTab clientId={CLIENT_ID} record={record} onChanged={() => undefined} mayWrite />);
    // Born 2015: a minor, so the guardian's consent is required as well as
    // taking part, and both are named in plain words.
    expect(await screen.findByText("Guardian's consent for a child")).toBeTruthy();
    expect(screen.getByText('Taking part')).toBeTruthy();
    expect(screen.getAllByText('Needed before this client can be activated').length).toBe(3);
    // The optional purposes are listed too, below the required ones, so a
    // person never has to wonder where photographs are recorded.
    expect(screen.getByText('Photographs and video')).toBeTruthy();
    // Three optional purposes, each saying nothing is on file without
    // implying anything is owed.
    expect(screen.getAllByText('Not recorded').length).toBe(3);
  });
});

describe('GoalsTab', () => {
  it('reads a goal by its category name and asks why before dropping one', async () => {
    const calls = mount(
      <GoalsTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite />,
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
    mount(<GoalsTab clientId={CLIENT_ID} record={record} onChanged={vi.fn()} mayWrite={false} />);
    expect(await screen.findByText('Settling at bedtime without a long wind-down.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add goal' })).toBeNull();
    expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true);
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
