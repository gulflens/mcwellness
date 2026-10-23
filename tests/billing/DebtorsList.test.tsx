// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BalancesSection } from '../../app/admin/billing/BalancesSection';
import { json, mountWith, narrowTo, OWNER } from './harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Billing › Balances opens on who owes the practice
 * (docs/superpowers/specs/2026-10-23-debtors-design.md, "Screen"). Every
 * figure below is the server's; the screen adds nothing up.
 */

const HAZEL = '00000005-0000-4000-8000-000000000001';
const ROWAN = '00000005-0000-4000-8000-000000000002';

const CLIENT = {
  id: HAZEL,
  mrn: 'MW-000001',
  givenName: 'Hazel',
  familyName: 'Harbour',
  givenNameAr: null,
  familyNameAr: null,
  age: 34,
  status: 'active' as const,
  contact: null,
  emirate: 'DXB',
};

function debtors(over: Record<string, unknown> = {}) {
  return {
    asOf: '2026-10-23',
    totals: {
      owedFils: 500_000,
      b0to30Fils: 200_000,
      b31to60Fils: 150_000,
      b61to90Fils: 100_000,
      over90Fils: 50_000,
      inCreditFils: 30_000,
      households: 2,
    },
    rows: [
      {
        clientId: HAZEL,
        name: 'Hazel Harbour',
        mrn: 'MW-000001',
        owedFils: 400_000,
        b0to30Fils: 150_000,
        b31to60Fils: 100_000,
        b61to90Fils: 100_000,
        over90Fils: 50_000,
        inCreditFils: 0,
        oldestOpenOn: '2026-06-02',
      },
      {
        clientId: ROWAN,
        name: 'Rowan Meadow',
        mrn: 'MW-000002',
        owedFils: 0,
        b0to30Fils: 0,
        b31to60Fils: 0,
        b61to90Fils: 0,
        over90Fils: 0,
        inCreditFils: 30_000,
        oldestOpenOn: null,
      },
    ],
    truncated: false,
    ...over,
  };
}

function balance() {
  return {
    clientId: HAZEL,
    services: [],
    delivered: 0,
    remaining: 0,
    remainingValueNetFils: 0,
    recognisedNetFils: 0,
    deferredNetFils: 0,
    nextExpiryOn: null,
    expiryWarning: 'none' as const,
    outstandingFils: 400_000,
    chargedFils: 400_000,
    paidFils: 0,
    creditedFils: 0,
    reversedFils: 0,
    purchases: [],
  };
}

function mount(list: Record<string, unknown> = debtors(), pdf: Response | null = null) {
  return mountWith(OWNER, <BalancesSection canWrite />, (url) => {
    if (url.startsWith('/api/billing/debtors.csv')) {
      return new Response('csv', {
        headers: { 'content-disposition': 'attachment; filename="debtors.csv"' },
      });
    }
    if (url.startsWith('/api/billing/debtors?')) return json(list);
    if (url === '/api/clients/search') return json({ clients: [CLIENT], note: null });
    if (url === `/api/billing/clients/${HAZEL}/balance`) return json(balance());
    if (url.startsWith(`/api/billing/clients/${HAZEL}/statement.pdf`)) {
      return pdf ?? new Response('pdf', { headers: { 'content-type': 'application/pdf' } });
    }
    return null;
  });
}

function urls(requests: { url: string }[]) {
  return requests.map((r) => r.url);
}

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  );
});

describe('Balances opens on the debtors list', () => {
  it('shows the As at date, the totals strip and the table columns', async () => {
    mount();
    await screen.findByText('Hazel Harbour');
    expect(screen.getByLabelText('As at')).toBeTruthy();
    const strip = screen.getByLabelText('Totals');
    for (const name of ['Owed', '0–30', '31–60', '61–90', 'Over 90', 'In credit']) {
      expect(within(strip).getByText(name)).toBeTruthy();
    }
    expect(within(strip).getByText('5,000.00')).toBeTruthy();
    for (const header of ['Client', 'Owed', '0–30', '31–60', '61–90', 'Over 90', 'Oldest open']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getByText('2 Jun 2026')).toBeTruthy();
  });

  it('says "In credit" for a household the practice holds money for', async () => {
    mount();
    const row = (await screen.findByText('Rowan Meadow')).closest('tr') as HTMLElement;
    expect(within(row).getByText(/In credit/)).toBeTruthy();
    expect(within(row).getByText(/300\.00/)).toBeTruthy();
  });

  it('asks again with ?asOf= when As at changes', async () => {
    const { requests } = mount();
    await screen.findByText('Hazel Harbour');
    fireEvent.change(screen.getByLabelText('As at'), { target: { value: '30/09/2026' } });
    await waitFor(() => expect(urls(requests)).toContain('/api/billing/debtors?asOf=2026-09-30'));
  });

  it('downloads the CSV for the date on screen', async () => {
    const { requests } = mount();
    await screen.findByText('Hazel Harbour');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() =>
      expect(urls(requests).some((u) => u.startsWith('/api/billing/debtors.csv?asOf='))).toBe(true),
    );
  });

  it('opens a household balance from its row, with a way back and a statement', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
    expect(await screen.findByRole('button', { name: 'All households' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Statement of account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All households' }));
    expect(await screen.findByText('Rowan Meadow')).toBeTruthy();
  });

  it('still opens a household directly from the picker', async () => {
    mount();
    await screen.findByText('Hazel Harbour');
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Harbour' } });
    fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour.*MW-000001/ }));
    expect(await screen.findByRole('button', { name: 'Statement of account' })).toBeTruthy();
  });

  it('says when only the largest fifty are shown', async () => {
    mount(debtors({ truncated: true }));
    expect(
      await screen.findByText('Showing the 50 largest balances. Download the CSV for all.'),
    ).toBeTruthy();
  });

  it('says nothing about truncation when everything is shown', async () => {
    mount();
    await screen.findByText('Hazel Harbour');
    expect(screen.queryByText(/largest balances/)).toBeNull();
  });

  it('says so when nobody owes anything', async () => {
    mount(debtors({ rows: [] }));
    expect(await screen.findByText('Nobody owes the practice anything.')).toBeTruthy();
  });

  it('names the problem when the list cannot load', async () => {
    mountWith(OWNER, <BalancesSection canWrite />, (url) =>
      url.startsWith('/api/billing/debtors?') ? json({}, 500) : null,
    );
    expect(await screen.findByText('The list could not be loaded. Try again.')).toBeTruthy();
  });

  it('shows a card per household on a phone', async () => {
    narrowTo(360);
    mount();
    await screen.findByText('Hazel Harbour');
    expect(screen.getByRole('list', { name: 'Households with a balance' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Client' })).toBeNull();
  });
});

describe('the statement drawer', () => {
  async function openDrawer() {
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Statement of account' }));
    return view;
  }

  it('asks for a period, from the first of two months back to today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    await openDrawer();
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe('01/08/2026');
    expect((within(dialog).getByLabelText('To') as HTMLInputElement).value).toBe('23/10/2026');
  });

  it('downloads the PDF for the household and period, by id only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    const { requests } = await openDrawer();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    await waitFor(() =>
      expect(urls(requests)).toContain(
        `/api/billing/clients/${HAZEL}/statement.pdf?from=2026-08-01&to=2026-10-23`,
      ),
    );
  });

  it('names the problem when the PDF cannot be prepared', async () => {
    const view = mountWith(OWNER, <BalancesSection canWrite />, (url) => {
      if (url.startsWith('/api/billing/debtors?')) return json(debtors());
      if (url === `/api/billing/clients/${HAZEL}/balance`) return json(balance());
      if (url.includes('statement.pdf')) return json({}, 500);
      return null;
    });
    void view;
    fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Statement of account' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    expect(
      await within(dialog).findByText('The file could not be prepared. Try again.'),
    ).toBeTruthy();
  });
});
