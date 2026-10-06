// @vitest-environment jsdom
import { createHash } from 'node:crypto';
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
 * Uploading a report made in another tool, on the client's Reports tab
 * (docs/SPEC/reports-v1.md section 12): offered to whoever may write a
 * report, refused in the browser when the file is not a PDF or is too large,
 * sent raw with its fingerprint, and then listed and opened as "Uploaded",
 * with Open and Send and no correction.
 *
 * Every id is in the reserved synthetic shape and every person comes from
 * `db/seed/names.ts` through `testActors` (.claude/rules/testing.md).
 */

afterEach(cleanup);

const CLIENT = '00000008-0000-4000-8000-000000000005';
const UPLOADED = '00000006-0000-4000-8000-000000000021';
const DOCUMENT = '00000006-0000-4000-8000-0000000000d2';
const CONTACT = '00000006-0000-4000-8000-0000000000c1';

/** A few bytes that begin as a PDF does. Nothing in them is anybody's. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PDF_DIGEST = createHash('sha256').update(PDF_BYTES).digest('hex');
const pdfFile = (): File => new File([PDF_BYTES], 'synthetic.pdf', { type: 'application/pdf' });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function uploadedRow(over: Record<string, unknown> = {}) {
  return {
    id: UPLOADED,
    clientId: CLIENT,
    kind: 'external',
    status: 'issued',
    locale: 'en',
    reference: 'RPT-000021',
    issuedOn: '2026-09-01',
    coverageFrom: null,
    coverageTo: null,
    signedByName: null,
    version: 1,
    supersedesId: null,
    amendmentReason: null,
    documentId: DOCUMENT,
    deliveries: 0,
    createdAt: '2026-09-02T08:00:00+04:00',
    title: 'Brain map, initial',
    ...over,
  };
}

type Sent = { url: string; method: string; headers: Headers; body: unknown };

function mount(
  me: unknown = LEAD_PRACTITIONER,
  options: { reports?: unknown[]; uploadAnswer?: { status: number; body: unknown } } = {},
) {
  const sent: Sent[] = [];
  let reports = options.reports ?? [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    if (url === '/api/me') return json(me);
    if (url.startsWith('/api/reports?clientId=')) return json({ reports });
    if (url.startsWith('/api/reports/external?')) {
      const answer = options.uploadAnswer ?? { status: 201, body: { report: uploadedRow() } };
      if (answer.status < 300) reports = [uploadedRow()];
      return json(answer.body, answer.status);
    }
    if (url === `/api/reports/${UPLOADED}`) {
      return json({
        report: uploadedRow(),
        content: { title: 'Brain map, initial', byteSize: PDF_BYTES.byteLength },
        deliveries: [],
        url: 'https://storage.example.com/signed',
        expiresInSeconds: 300,
      });
    }
    if (url === `/api/clients/${CLIENT}`) {
      return json({ contacts: [{ id: CONTACT, relationship: 'mother', canReceiveReports: true }] });
    }
    return json({ error: 'not_found' }, 404);
  });
  render(
    <AuthProviderBoundary provider={signedInProvider} fetchImpl={fetchImpl}>
      <ReportsTab clientId={CLIENT} />
    </AuthProviderBoundary>,
  );
  return sent;
}

async function openForm(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Upload a PDF report' }));
  await screen.findByLabelText('The PDF');
}

function fill(over: { title?: string; date?: string; file?: File } = {}): void {
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: over.title ?? 'Brain map, initial' },
  });
  fireEvent.change(screen.getByLabelText('Date on the report'), {
    target: { value: over.date ?? '01/09/2026' },
  });
  fireEvent.change(screen.getByLabelText('The PDF'), {
    target: { files: [over.file ?? pdfFile()] },
  });
}

describe('uploading a PDF report', () => {
  it('is offered to whoever may write a report', async () => {
    mount(LEAD_PRACTITIONER);
    expect(await screen.findByRole('button', { name: 'Upload a PDF report' })).toBeTruthy();
    cleanup();
    mount(PRACTITIONER);
    expect(await screen.findByRole('button', { name: 'Upload a PDF report' })).toBeTruthy();
  });

  it('is not offered to an admin or to finance, who never write one', async () => {
    mount(ADMIN);
    await screen.findByText('No reports have been written for this client yet.');
    expect(screen.queryByRole('button', { name: 'Upload a PDF report' })).toBeNull();
    cleanup();
    mount(FINANCE);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Upload a PDF report' })).toBeNull(),
    );
  });

  it('chooses PDFs only', async () => {
    mount();
    await openForm();
    expect(screen.getByLabelText('The PDF').getAttribute('accept')).toBe('application/pdf,.pdf');
  });

  it('sends the bytes raw, with their fingerprint, the title and the date', async () => {
    const sent = mount();
    await openForm();
    fill({ title: 'Brain map, initial' });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(sent.some((call) => call.method === 'POST')).toBe(true));

    const post = sent.find((call) => call.method === 'POST')!;
    expect(post.url).toBe(`/api/reports/external?clientId=${CLIENT}&reportDate=2026-09-01`);
    expect(post.headers.get('content-type')).toBe('application/pdf');
    expect(post.headers.get('x-sha256')).toBe(PDF_DIGEST);
    // The title in a header, percent-encoded, and never in the address.
    expect(post.headers.get('x-report-title')).toBe(encodeURIComponent('Brain map, initial'));
    expect(post.url).not.toContain('Brain');
    expect(new Uint8Array(post.body as ArrayBuffer)).toEqual(PDF_BYTES);

    // And it lands on the report it filed, with Open and Send.
    expect(await screen.findByRole('button', { name: 'Open the report' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('refuses a file that is not a PDF before sending anything', async () => {
    const sent = mount();
    await openForm();
    fill({ file: new File(['<html></html>'], 'synthetic.html', { type: 'text/html' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(
      await screen.findByText('That file is not a PDF. Choose the PDF the report was saved as.'),
    ).toBeTruthy();
    expect(sent.some((call) => call.method === 'POST')).toBe(false);
  });

  it('refuses a file over twenty megabytes before reading it', async () => {
    const sent = mount();
    await openForm();
    const big = pdfFile();
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 });
    fill({ file: big });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(
      await screen.findByText(
        'That file is larger than 20 MB. Save the report again at a smaller size.',
      ),
    ).toBeTruthy();
    expect(sent.some((call) => call.method === 'POST')).toBe(false);
  });

  it('asks for a title before sending', async () => {
    const sent = mount();
    await openForm();
    fill({ title: '   ' });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(
      await screen.findByText('Give the report a title, so it can be told apart on the list.'),
    ).toBeTruthy();
    expect(sent.some((call) => call.method === 'POST')).toBe(false);
  });

  it('says in a sentence why the server refused it', async () => {
    mount(LEAD_PRACTITIONER, {
      uploadAnswer: { status: 403, body: { error: 'forbidden', code: 'not_permitted' } },
    });
    await openForm();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('You may not upload a report for this client.')).toBeTruthy();
  });
});

describe('an uploaded report on the list and on its page', () => {
  it('is listed as "Uploaded", with its title beneath its reference', async () => {
    mount(LEAD_PRACTITIONER, { reports: [uploadedRow()] });
    expect(await screen.findByRole('button', { name: 'RPT-000021' })).toBeTruthy();
    expect(screen.getByText('Brain map, initial')).toBeTruthy();
    expect(screen.getByText('Uploaded')).toBeTruthy();
  });

  it('opens with Open and Send, says what it is, and offers no correction', async () => {
    mount(LEAD_PRACTITIONER, { reports: [uploadedRow()] });
    fireEvent.click(await screen.findByRole('button', { name: 'RPT-000021' }));
    expect(await screen.findByText('Uploaded report')).toBeTruthy();
    expect(screen.getByText('Brain map, initial')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the report' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct this report' })).toBeNull();
    expect(screen.queryByText('Signed by')).toBeNull();
  });
});
