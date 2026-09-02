// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingPage } from '../../app/admin/billing/BillingPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

// Synthetic throughout: seeded-shaped ids, following the reserved test range
// (.claude/rules/testing.md) the same way app/admin/audit/RecordTimeline.test.tsx does.
const OWNER = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
  capabilities: [],
};
const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000002',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['lead_practitioner'],
  capabilities: [],
};

const PRICES = {
  prices: [
    {
      id: '00000004-0000-4000-8000-000000000101',
      serviceTypeId: '00000004-0000-4000-8000-000000000005',
      serviceTypeCode: 'nf-session',
      serviceTypeName: 'Neurofeedback session',
      serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
      unitPriceFils: 90_000,
      vatRateBasisPoints: 500,
      vatFils: 4_500,
      grossFils: 94_500,
      validFrom: '2026-09-02',
      supersedesId: null,
      amendmentReason: 'Setting the launch price.',
    },
  ],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(me: unknown, pricesStatus: { body: unknown; status?: number }) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url.startsWith('/api/billing/prices')) {
      return json(pricesStatus.body, pricesStatus.status ?? 200);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <BillingPage />
    </AuthProviderBoundary>,
  );
  return fetchImpl;
}

describe('BillingPage', () => {
  it("renders the price list's seeded-shaped rows: the service, its Arabic name, unit price, VAT, total and effective date", async () => {
    mount(OWNER, { body: PRICES });
    expect(await screen.findByText('Neurofeedback session')).toBeTruthy();
    expect(screen.getByText('جلسة التغذية الراجعة العصبية')).toBeTruthy();
    expect(screen.getByText('AED 900.00')).toBeTruthy();
    expect(screen.getByText('AED 45.00')).toBeTruthy();
    expect(screen.getByText('AED 945.00')).toBeTruthy();
    expect(screen.getByText('2026-09-02')).toBeTruthy();
  });

  it('offers "Add price" to the owner', async () => {
    mount(OWNER, { body: PRICES });
    expect(await screen.findByRole('button', { name: 'Add price' })).toBeTruthy();
  });

  it('hides "Add price" from a lead practitioner, who may read the list but not write to it', async () => {
    mount(LEAD_PRACTITIONER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    expect(screen.queryByRole('button', { name: 'Add price' })).toBeNull();
  });

  it('says so when no price has been set yet', async () => {
    mount(OWNER, { body: { prices: [] } });
    expect(await screen.findByText('No prices are set yet.')).toBeTruthy();
  });

  it('names the problem when the list fails to load', async () => {
    mount(OWNER, { body: { error: 'forbidden' }, status: 403 });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The price list could not be loaded. Try again.',
    );
  });
});
