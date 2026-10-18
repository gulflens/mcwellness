// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportRow } from '../../api/reports/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import { RecordSummary, latestIssued } from './RecordSummary';
import { ADMIN, signedInProvider } from './testActors';

afterEach(cleanup);

const CLIENT_ID = '00000008-0000-4000-8000-0000000000f2';
const REPORT_A = '0000000b-0000-4000-8000-0000000000a1';
const REPORT_B = '0000000b-0000-4000-8000-0000000000a2';
const REPORT_C = '0000000b-0000-4000-8000-0000000000a3';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function balance(over: Partial<Record<string, unknown>> = {}) {
  return {
    clientId: CLIENT_ID,
    services: [],
    delivered: 12,
    remaining: 13,
    remainingValueNetFils: 0,
    recognisedNetFils: 0,
    deferredNetFils: 0,
    nextExpiryOn: null,
    expiryWarning: 'none',
    outstandingFils: 125_000,
    chargedFils: 125_000,
    paidFils: 0,
    purchases: [],
    ...over,
  };
}

function report(over: Partial<ReportRow>): ReportRow {
  return {
    id: REPORT_A,
    clientId: CLIENT_ID,
    kind: 'progress',
    status: 'issued',
    locale: 'en',
    reference: null,
    issuedOn: '2026-10-01',
    coverageFrom: null,
    coverageTo: null,
    signedByName: null,
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: null,
    deliveries: 0,
    createdAt: '2026-10-01T08:00:00Z',
    twinOfId: null,
    twinId: null,
    outOfStep: false,
    ...over,
  } as ReportRow;
}

function mount({
  balanceReply = () => json(balance()),
  reportsReply = () => json({ reports: [] }),
}: { balanceReply?: () => Response; reportsReply?: () => Response } = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(ADMIN);
    if (url.endsWith('/balance')) return balanceReply();
    if (url.startsWith('/api/reports')) return reportsReply();
    return json({}, 404);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <RecordSummary clientId={CLIENT_ID} />
    </AuthProviderBoundary>,
  );
}

describe('latestIssued', () => {
  it('picks the newest issued report and skips drafts and replaced versions', () => {
    const picked = latestIssued([
      report({ id: REPORT_A, issuedOn: '2026-09-01' }),
      report({ id: REPORT_B, issuedOn: '2026-10-05', status: 'draft' }),
      report({ id: REPORT_C, issuedOn: '2026-09-20', supersedesId: REPORT_A }),
    ]);
    expect(picked?.id).toBe(REPORT_C);
  });

  it('never offers a withdrawn record as the latest', () => {
    const picked = latestIssued([
      report({ id: REPORT_A, issuedOn: '2026-09-01' }),
      report({ id: REPORT_B, issuedOn: '2026-10-05', withdrawn: true }),
    ]);
    expect(picked?.id).toBe(REPORT_A);
  });

  it('answers null when nothing has been issued', () => {
    expect(latestIssued([report({ status: 'draft', issuedOn: null })])).toBeNull();
  });
});

describe('RecordSummary', () => {
  it('leads with sessions delivered of the total and what the household owes', async () => {
    mount();
    expect(await screen.findByText('12 of 25')).toBeTruthy();
    expect(screen.getByText('13 sessions to come.')).toBeTruthy();
    expect(screen.getByText('AED 1,250.00')).toBeTruthy();
    expect(screen.getByText('Owed by the household')).toBeTruthy();
    expect(await screen.findByText('None yet')).toBeTruthy();
  });

  it('says nothing is owed at a zero balance, and names a programme not yet started', async () => {
    mount({
      balanceReply: () => json(balance({ delivered: 0, remaining: 0, outstandingFils: 0 })),
    });
    expect(await screen.findByText('Nothing owed')).toBeTruthy();
    expect(screen.getByText('Not started')).toBeTruthy();
  });

  it('leaves out a block the role may not read, without an error', async () => {
    mount({ reportsReply: () => json({ error: 'not_permitted' }, 403) });
    expect(await screen.findByText('12 of 25')).toBeTruthy();
    expect(screen.queryByText('Latest report')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when a read fails', async () => {
    mount({ balanceReply: () => json({}, 500) });
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
