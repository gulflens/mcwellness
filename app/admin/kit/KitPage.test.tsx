// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { KitPage } from './KitPage';

afterEach(cleanup);

/**
 * Settings › Kit against a fake API (docs/SPEC/practitioner-phone.md section
 * 6.4). Every id, name and serial is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md) — a serial takes the same shape an id does, so
 * "no real serial" is a property of the text — and no real model name appears
 * anywhere.
 */

const ME = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const DUBAI = 'Asia/Dubai';
const IN_DATE = new Date(Date.now() + 200 * 86_400_000).toISOString();
const LAPSED = new Date(Date.now() - 5 * 86_400_000).toISOString();

/**
 * Dubai midnights, which is how the route stores a calibration date
 * (`atPracticeMidnight` in `app/api/kit/routes.ts`). They are written as the
 * instants they are, because the answer's schema is `z.iso.datetime()` and
 * takes Z and not an offset — but the point is the four hours: read in UTC
 * these are the day before, so the drawer showing the 5th is the practice's
 * zone doing its work and nothing else.
 */
const CALIBRATED_2026_01_05 = '2026-01-04T20:00:00.000Z'; // 2026-01-05T00:00:00+04:00
const CALIBRATED_2025_01_05 = '2025-01-04T20:00:00.000Z'; // 2025-01-05T00:00:00+04:00

const KIT = [
  {
    id: '00000009-0000-4000-8000-000000000001',
    serial: '0000000e-0000-4000-8000-000000000001',
    model: 'Synthetic Bench Unit',
    kind: 'amplifier',
    status: 'active',
    assignedPractitionerId: '00000005-0000-4000-8000-000000000001',
    assignedTo: 'Rowan Meadow',
    lastCalibratedAt: CALIBRATED_2026_01_05,
    calibrationDueAt: IN_DATE,
  },
  {
    id: '00000009-0000-4000-8000-000000000002',
    serial: '0000000e-0000-4000-8000-000000000002',
    model: 'Synthetic Bench Unit',
    kind: 'amplifier',
    status: 'active',
    assignedPractitionerId: null,
    assignedTo: null,
    lastCalibratedAt: CALIBRATED_2025_01_05,
    calibrationDueAt: LAPSED,
  },
  {
    id: '00000009-0000-4000-8000-000000000003',
    serial: '0000000e-0000-4000-8000-000000000003',
    model: 'Synthetic Field Laptop',
    kind: 'laptop',
    status: 'inactive',
    assignedPractitionerId: null,
    assignedTo: null,
    lastCalibratedAt: null,
    calibrationDueAt: null,
  },
];

const OPTIONS = {
  practitioners: [{ id: '00000005-0000-4000-8000-000000000001', displayName: 'Rowan Meadow' }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Sent = { url: string; method: string; reason: string | null; body: unknown };

function mount(options: { listStatus?: number } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/me')) return json(ME);
    if (url.endsWith('/api/kit/options')) return json(OPTIONS);
    if (url.endsWith('/api/kit') && method === 'GET') {
      return options.listStatus === undefined
        ? json({ kit: KIT })
        : json({ error: 'forbidden' }, options.listStatus);
    }
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    sent.push({
      url,
      method,
      reason: headers.get('x-reason'),
      body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as unknown),
    });
    return json(
      { ...KIT[0], serial: '0000000e-0000-4000-8000-000000000009' },
      method === 'POST' ? 201 : 200,
    );
  }) as unknown as typeof fetch;

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <KitPage />
    </AuthProviderBoundary>,
  );
  return sent;
}

describe('the register', () => {
  it('shows every item with its serial, who carries it and its calibration', async () => {
    mount();
    expect(await screen.findByText('0000000e-0000-4000-8000-000000000001')).toBeTruthy();
    expect(screen.getByText('0000000e-0000-4000-8000-000000000003')).toBeTruthy();
    expect(screen.getByText('Rowan Meadow')).toBeTruthy();
    // An unassigned item says so rather than showing a blank.
    expect(screen.getAllByText('Nobody').length).toBeGreaterThan(0);
  });

  it('says which item is overdue, which is in service and which is stood down', async () => {
    mount();
    expect(await screen.findByText('Calibration overdue')).toBeTruthy();
    expect(screen.getByText('In service')).toBeTruthy();
    expect(screen.getByText('Stood down')).toBeTruthy();
  });

  it('says whose the register is when the API refuses', async () => {
    mount({ listStatus: 403 });
    expect(await screen.findByText(/is the owner/)).toBeTruthy();
  });
});

describe('the drawer', () => {
  it('adds an item without asking for a reason', async () => {
    const sent = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    fireEvent.change(screen.getByLabelText('Serial number'), {
      target: { value: '0000000e-0000-4000-8000-000000000009' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'Synthetic Bench Unit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.reason).toBeNull();
    expect(sent[0]?.body).toMatchObject({
      serial: '0000000e-0000-4000-8000-000000000009',
      kind: 'amplifier',
      assignedPractitionerId: null,
    });
  });

  it('will not record a calibration without a reason, and sends it once given', async () => {
    const sent = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]!);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Calibration runs out'), {
      target: { value: '2027-06-30' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Calibration certificate received.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.reason).toBe('Calibration certificate received.');
    // Only the field that changed: an edit to one thing is an edit to one thing.
    expect(sent[0]?.body).toEqual({ calibrationDueAt: '2027-06-30' });
  });

  it('opens an item and saves it unchanged without moving either date', async () => {
    const sent = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]!);

    // The dates are read in the practice's own zone. The register stores a
    // calibration as Dubai midnight, so a field filled from the UTC date of
    // that instant would show — and send back — the day before. The fixture is
    // a Dubai midnight for exactly that reason: read in UTC it is the 4th, so
    // this line fails if the zone is ever dropped.
    expect((screen.getByLabelText('Last calibrated') as HTMLInputElement).value).toBe('2026-01-05');
    const due = screen.getByLabelText('Calibration runs out') as HTMLInputElement;
    expect(due.value).toBe(new Date(IN_DATE).toLocaleDateString('en-CA', { timeZone: DUBAI }));

    // A reason, and nothing else touched: the drawer closes and asks for
    // nothing, because there is nothing to say.
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Checked the certificate against the register.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent).toEqual([]);
  });

  it('sends the field that changed and leaves both dates alone', async () => {
    const sent = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]!);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Synthetic Bench Two' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'The label on the case was wrong.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ model: 'Synthetic Bench Two' });
  });

  it('offers standing an item down and never deleting it', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]!);
    expect(screen.getByRole('option', { name: 'Stood down' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });
});
