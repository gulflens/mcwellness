// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { ReportsTab } from '../../app/admin/reports/ReportsTab';
import {
  ADMIN,
  FINANCE,
  LEAD_PRACTITIONER,
  PRACTITIONER,
  signedInProvider,
} from '../../app/admin/clients/testActors';

/**
 * The Reports tab, against a fake API (docs/SPEC/reports-v1.md section 4.1).
 *
 * The screen's job is to show the chain and to offer only what the person
 * signed in may actually do. Whether they may is decided in
 * `domain/shared/actor.ts` and enforced in the database; this proves the
 * screen agrees with it rather than inventing its own answer.
 *
 * Every id is in the reserved synthetic shape and every person comes from
 * `db/seed/names.ts` through `testActors` (.claude/rules/testing.md).
 */

afterEach(cleanup);

const CLIENT = '00000008-0000-4000-8000-000000000005';
const FIRST = '00000006-0000-4000-8000-000000000001';
const SECOND = '00000006-0000-4000-8000-000000000002';
const DRAFT = '00000006-0000-4000-8000-000000000003';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: FIRST,
    clientId: CLIENT,
    kind: 'progress',
    status: 'issued',
    locale: 'en',
    reference: 'RPT-000001',
    issuedOn: '2026-09-01',
    coverageFrom: '2026-06-01',
    coverageTo: '2026-09-01',
    signedByName: 'Hazel Harbour',
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: '00000006-0000-4000-8000-0000000000d1',
    deliveries: 0,
    createdAt: '2026-09-01T08:00:00+04:00',
    ...over,
  };
}

/** A signer, so the editor's own signing door is offered where it should be. */
const SIGNER = {
  ...LEAD_PRACTITIONER,
  capabilities: [
    {
      serviceTypeId: '00000000-0000-4000-8000-0000000000f1',
      canExecuteSession: true,
      canAuthorProtocol: false,
      canSignReport: true,
      validFrom: '2024-01-01',
      validTo: null,
    },
  ],
};

function mount(reports: unknown[], me: unknown = LEAD_PRACTITIONER) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url.startsWith('/api/reports?clientId=')) return json({ reports });
    return json({ error: 'not_found' }, 404);
  });
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <ReportsTab clientId={CLIENT} />
    </AuthProviderBoundary>,
  );
  return fetchImpl;
}

describe('the Reports tab', () => {
  it('shows a report by its reference, its kind, what it covers and who signed it', async () => {
    mount([row()]);
    expect(await screen.findByText('RPT-000001')).toBeTruthy();
    expect(screen.getByText('Progress')).toBeTruthy();
    expect(screen.getByText('2026-06-01 to 2026-09-01')).toBeTruthy();
    expect(screen.getByText('Hazel Harbour')).toBeTruthy();
  });

  it('says in words whether a household has been sent it, never a count', async () => {
    // A count would invite somebody to read a report sent twice as a report
    // sent better. The column heading is also the word "Sent", so this reads
    // the row's own cell rather than the first match on the page.
    mount([row({ deliveries: 0 })]);
    await screen.findByText('RPT-000001');
    expect(document.querySelector('tbody tr td:last-child')?.textContent).toBe('Not sent');
    cleanup();
    mount([row({ id: SECOND, deliveries: 2 })]);
    await screen.findByText('RPT-000001');
    expect(document.querySelector('tbody tr td:last-child')?.textContent).toBe('Sent');
  });

  it('puts a superseded version beneath the one that replaced it, with its reason', async () => {
    mount([
      row({ id: FIRST, status: 'superseded', amendmentReason: 'The visit date was wrong.' }),
      row({
        id: SECOND,
        reference: 'RPT-000002',
        version: 2,
        supersedesId: FIRST,
      }),
    ]);
    const head = await screen.findByText('RPT-000002');
    expect(head).toBeTruthy();
    // The replaced one is still readable and says why it was replaced.
    expect(screen.getByText('RPT-000001')).toBeTruthy();
    expect(screen.getByText(/The visit date was wrong\./)).toBeTruthy();
    // And it is drawn beneath its successor rather than beside it.
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.className).not.toContain('superseded');
    expect(rows[1]?.className).toContain('superseded');
  });

  it('shows a draft with no reference at all', async () => {
    mount([row({ id: DRAFT, status: 'draft', reference: null, signedByName: null })]);
    expect(await screen.findByText('Not yet signed')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('opens a draft in the editor, loaded with it, rather than in the viewer', async () => {
    // Every row used to open in ReportView, which offers a draft no edit, no
    // preview and no signature — so a saved draft could be finished only
    // through the API.
    const draft = row({ id: DRAFT, status: 'draft', reference: null, signedByName: null });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(SIGNER);
      if (url.startsWith('/api/reports?clientId=')) return json({ reports: [draft] });
      if (url === `/api/reports/${DRAFT}`) {
        return json({
          report: draft,
          content: {
            kind: 'progress',
            coverageFrom: '2026-06-01',
            coverageTo: '2026-09-01',
            sessionsDelivered: 4,
            sessionsEntitled: 10,
            goals: [],
            ribbon: { slices: [], remaining: 0 },
            comparison: null,
            summary: 'Half written and saved.',
            suggestion: '',
          },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        });
      }
      if (url.startsWith('/api/reports/gather')) {
        return json({
          content: {
            kind: 'progress',
            coverageFrom: '2026-06-01',
            coverageTo: '2026-09-01',
            sessionsDelivered: 4,
            sessionsEntitled: 10,
            goals: [],
            ribbon: { slices: [], remaining: 0 },
            comparison: null,
            summary: '',
            suggestion: '',
          },
          brainMapsRead: false,
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Not yet signed' }));
    const summary = (await screen.findByLabelText('Summary')) as HTMLTextAreaElement;
    expect(summary.value).toBe('Half written and saved.');
    expect(screen.getByRole('button', { name: 'Sign this report' })).toBeTruthy();
  });

  it('lands in the editor on the corrected draft a supersede started', async () => {
    const issued = row();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(SIGNER);
      if (url.startsWith('/api/reports?clientId=')) return json({ reports: [issued] });
      if (url === `/api/reports/${FIRST}`) {
        return json({
          report: issued,
          content: { kind: 'progress' },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        });
      }
      if (url === `/api/reports/${FIRST}/supersede`) {
        return json(
          { report: { ...issued, id: DRAFT, status: 'draft', reference: null, version: 2 } },
          201,
        );
      }
      if (url === `/api/reports/${DRAFT}`) {
        return json({
          report: { ...issued, id: DRAFT, status: 'draft', reference: null, version: 2 },
          content: {
            kind: 'progress',
            coverageFrom: '2026-06-01',
            coverageTo: '2026-09-01',
            sessionsDelivered: 4,
            sessionsEntitled: 10,
            goals: [],
            ribbon: { slices: [], remaining: 0 },
            comparison: null,
            summary: 'The corrected wording.',
            suggestion: '',
          },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        });
      }
      if (url === `/api/clients/${CLIENT}`) return json({ contacts: [] });
      if (url.startsWith('/api/reports/gather')) {
        return json({
          content: {
            kind: 'progress',
            coverageFrom: '2026-06-01',
            coverageTo: '2026-09-01',
            sessionsDelivered: 4,
            sessionsEntitled: 10,
            goals: [],
            ribbon: { slices: [], remaining: 0 },
            comparison: null,
            summary: '',
            suggestion: '',
          },
          brainMapsRead: false,
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'RPT-000001' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Correct this report' }));
    fireEvent.change(screen.getByLabelText('Why a new version is needed'), {
      target: { value: 'The coverage ended a week later.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new version' }));

    const summary = (await screen.findByLabelText('Summary')) as HTMLTextAreaElement;
    expect(summary.value).toBe('The corrected wording.');
    expect(screen.getByRole('button', { name: 'Sign this report' })).toBeTruthy();
  });

  it('offers writing a report to a lead practitioner and not to finance', async () => {
    mount([], LEAD_PRACTITIONER);
    expect(await screen.findByRole('button', { name: 'Write a progress report' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Write a session report' })).toBeTruthy();
    cleanup();
    mount([], FINANCE);
    await waitFor(() => expect(screen.queryByText('Loading.')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Write a progress report' })).toBeNull();
  });

  it('does not offer an admin the writing door, because an admin never drafts', async () => {
    mount([], ADMIN);
    await waitFor(() => expect(screen.queryByText('Loading.')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Write a progress report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write a session report' })).toBeNull();
  });

  it('offers a practitioner the writing door and not the correcting one', async () => {
    // Section 7.1 gives superseding to the owner and the lead practitioner
    // alone. The route and the row both refuse it (migration 600); the screen
    // agrees, so nobody is offered an act the server would turn away.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(PRACTITIONER);
      if (url.startsWith('/api/reports?clientId=')) return json({ reports: [row()] });
      if (url === `/api/reports/${FIRST}`) {
        return json({
          report: row(),
          content: { kind: 'progress' },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        });
      }
      if (url === `/api/clients/${CLIENT}`) return json({ contacts: [] });
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    expect(await screen.findByRole('button', { name: 'Write a progress report' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'RPT-000001' }));
    await screen.findByText('Progress report');
    expect(screen.queryByRole('button', { name: 'Correct this report' })).toBeNull();
  });

  it('says nothing has been written yet, rather than showing an empty table', async () => {
    mount([]);
    expect(
      await screen.findByText('No reports have been written for this client yet.'),
    ).toBeTruthy();
  });

  it('offers nothing at all on an erased record, and says why', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(SIGNER);
      if (url.startsWith('/api/reports?clientId=')) return json({ reports: [] });
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} erased />
      </AuthProviderBoundary>,
    );
    expect(
      await screen.findByText('This record has been erased. Nothing is held about it any more.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write a progress report' })).toBeNull();
  });

  it('opens one from its reference', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(LEAD_PRACTITIONER);
      if (url.startsWith('/api/reports?clientId=')) return json({ reports: [row()] });
      if (url === `/api/reports/${FIRST}`) {
        return json({
          report: row(),
          content: { kind: 'progress' },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
        });
      }
      if (url === `/api/clients/${CLIENT}`) return json({ contacts: [] });
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'RPT-000001' }));
    expect(await screen.findByText('Progress report')).toBeTruthy();
  });

  it('says the reports could not be loaded rather than showing an empty list', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(LEAD_PRACTITIONER);
      return json({ error: 'internal' }, 500);
    });
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <ReportsTab clientId={CLIENT} />
      </AuthProviderBoundary>,
    );
    expect(await screen.findByText('The reports could not be loaded.')).toBeTruthy();
  });
});
