// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportsScreen } from '../../app/client/ReportsScreen';
import type { PortalReportsResponse } from '../../app/api/portal/schema';
import { CHILD_A, CHILD_B, HOME } from '../portal/fixtures';
import { json, mountPortal } from '../portal/harness';

/**
 * The household's own Reports screen, against a fake API, in both languages
 * (docs/SPEC/reports-v1.md section 7.3; docs/SPEC/client-portal.md section 13
 * asks every portal screen to be rendered this way).
 *
 * Every fixture is synthetic and every id is in the reserved shape
 * (.claude/rules/testing.md).
 */

afterEach(cleanup);

const FIRST = '00000006-0000-4000-8000-000000000001';
const SECOND = '00000006-0000-4000-8000-000000000002';
const DOCUMENT = '00000006-0000-4000-8000-0000000000d1';

const REPORTS: PortalReportsResponse = {
  clients: HOME.clients,
  reports: [
    {
      id: FIRST,
      clientId: CHILD_A,
      kind: 'progress',
      status: 'issued',
      reference: 'RPT-000002',
      issuedOn: '2026-09-01',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      version: 2,
      documentId: DOCUMENT,
    },
    {
      id: SECOND,
      clientId: CHILD_B,
      kind: 'session',
      status: 'issued',
      reference: 'RPT-000003',
      issuedOn: '2026-08-20',
      coverageFrom: null,
      coverageTo: null,
      version: 1,
      documentId: null,
    },
  ],
};

function mount(body: PortalReportsResponse = REPORTS, locale: 'en' | 'ar' = 'en') {
  return mountPortal(<ReportsScreen />, {
    locale,
    answers: {
      '/api/portal/home': () => json(HOME),
      '/api/portal/reports/': () =>
        json({ url: 'https://storage.example.com/x', expiresInSeconds: 300 }),
      '/api/portal/reports': () => json(body),
    },
  });
}

describe('the household’s Reports screen', () => {
  it('lists a report by its reference, its kind and what it covers', async () => {
    mount();
    expect(await screen.findByText('RPT-000002')).toBeTruthy();
    expect(screen.getByText('Progress report')).toBeTruthy();
    expect(screen.getByText('Session report')).toBeTruthy();
    expect(screen.getByText('1 June 2026 to 1 September 2026')).toBeTruthy();
  });

  it('heads each client’s reports with the client’s own name', async () => {
    mount();
    expect(await screen.findByText('Cedar Meadow')).toBeTruthy();
    expect(screen.getByText('Clover Meadow')).toBeTruthy();
  });

  it('never carries the report’s body in the answer it renders', async () => {
    // A household's most personal document opens through a link, not through
    // every response the screen makes.
    mount();
    await screen.findByText('RPT-000002');
    expect(document.body.textContent).not.toContain('summary');
    expect(document.body.textContent).not.toContain('Sessions delivered');
  });

  it('opens one through a link fetched when the button is pressed', async () => {
    const { calls } = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0] as HTMLElement);
    await waitFor(() =>
      expect(calls.some((call) => call.path === `/api/portal/reports/${DOCUMENT}/link`)).toBe(true),
    );
    // And no link is in the markup before that.
    expect(document.querySelector('a[href*="storage.example.com"]')).toBeNull();
  });

  it('offers no button for a report with no filed document', async () => {
    mount();
    await screen.findByText('RPT-000003');
    // One document between the two reports, so one button.
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(1);
  });

  it('says nothing has been written yet, rather than showing an empty list', async () => {
    mount({ clients: HOME.clients, reports: [] });
    expect(await screen.findByText('No reports have been written yet.')).toBeTruthy();
  });

  it('says a version has been replaced where the household holds one', async () => {
    mount({
      clients: HOME.clients,
      reports: [{ ...REPORTS.reports[0]!, status: 'superseded' }],
    });
    expect(await screen.findByText('Replaced by a newer version')).toBeTruthy();
  });

  it('renders in Arabic, right to left, with no English left in the fixed words', async () => {
    mount(REPORTS, 'ar');
    expect(await screen.findByText('التقارير')).toBeTruthy();
    expect(screen.getByText('تقرير التقدّم')).toBeTruthy();
    expect(document.querySelector('.portal')?.getAttribute('dir')).toBe('rtl');
    expect(screen.queryByText('Progress report')).toBeNull();
  });
});
