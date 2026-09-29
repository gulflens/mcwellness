// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import { LEAD_PRACTITIONER, signedInProvider } from '../../app/admin/clients/testActors';
import { QeegEditor } from '../../app/admin/reports/qeeg/QeegEditor';
import { blankInitial } from '../../domain/reports/qeeg/blank';

/**
 * The brain-map form knows a save made over a newer one by the route's
 * `code`, never by the sentence it shows (review M, note 6). Here the sentence
 * for that code is worded differently from the table's, as it would be after a
 * rewording: the form must still stop saving and offer the newer version.
 * A check that compared sentences would not.
 */

const REWORDED = 'Someone saved a newer version of this draft.';

vi.mock('../../app/admin/reports/qeeg/refusals', async (original) => {
  const actual = await original<typeof import('../../app/admin/reports/qeeg/refusals')>();
  return {
    ...actual,
    refusalSentence: (status: number, body: unknown) =>
      (body as { code?: unknown } | null)?.code === 'stale_draft'
        ? REWORDED
        : actual.refusalSentence(status, body),
  };
});

afterEach(cleanup);

const CLIENT = '00000008-0000-4000-8000-000000000005';
const DRAFT = '00000006-0000-4000-8000-000000000009';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ROW = {
  id: DRAFT,
  clientId: CLIENT,
  kind: 'qeeg',
  status: 'draft',
  locale: 'en',
  reference: null,
  issuedOn: null,
  coverageFrom: null,
  coverageTo: null,
  signedByName: null,
  version: 1,
  supersedesId: null,
  amendmentReason: null,
  documentId: null,
  deliveries: 0,
  createdAt: '2026-09-30T08:00:00+04:00',
};

describe('a stale save, reworded', () => {
  it('still stops the form and offers the newer version', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(LEAD_PRACTITIONER);
      if (url === '/api/reports/draft') {
        return json({ error: 'conflict', code: 'stale_draft' }, 409);
      }
      if (url === `/api/reports/${DRAFT}`) {
        return json({
          report: ROW,
          content: { ...blankInitial(), subject: { nameAr: null, ageYears: 9, sex: 'female' } },
          deliveries: [],
          url: null,
          expiresInSeconds: null,
          savedAt: '2026-09-30T08:00:00.000000Z',
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    const user = userEvent.setup();
    render(
      <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
        <QeegEditor
          clientId={CLIENT}
          reportId={DRAFT}
          start={null}
          reports={[]}
          onDone={() => undefined}
        />
      </AuthProviderBoundary>,
    );
    await user.click(await screen.findByRole('button', { name: /^Key findings/ }));
    await user.click(screen.getByLabelText('Mental Fatigue'));
    await user.click(screen.getByRole('button', { name: 'Save the draft' }));

    expect(await screen.findByText(REWORDED)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load the newer version' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save the draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
