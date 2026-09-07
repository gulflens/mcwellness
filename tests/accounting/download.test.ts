// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_REFUSED, downloadCsv, filenameFrom } from '../../app/admin/accounting/download';
import type { ApiFetch } from '../../app/shell/auth/AuthContext';

/**
 * The books' files, fetched with the token rather than navigated to
 * (docs/SPEC/accounting.md sections 4.5 and 5.4). jsdom has no object URLs of
 * its own, so both halves of the pair are stubbed here and counted: a helper
 * that leaks an address is what this test is for.
 */

const CSV = 'Account code,Account name\r\n1010,Bank\r\n';

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      const url = `blob:mcwellness/${created.length}`;
      created.push(url);
      return url;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  });
});

function csvResponse(disposition: string | null): Response {
  const headers = new Headers({ 'content-type': 'text/csv; charset=utf-8' });
  if (disposition !== null) {
    headers.set('content-disposition', disposition);
  }
  return new Response(CSV, { status: 200, headers });
}

/** Watches the temporary anchor: jsdom's own click on a download link does nothing. */
function watchClicks(): { clicked: { name: string; href: string }[]; stop: () => void } {
  const clicked: { name: string; href: string }[] = [];
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ name: this.download, href: this.getAttribute('href') ?? '' });
  });
  return { clicked, stop: () => spy.mockRestore() };
}

describe('filenameFrom', () => {
  it('takes the name the server put on the file', () => {
    expect(filenameFrom('attachment; filename="trial-balance-2026-12-31.csv"', '/x.csv')).toBe(
      'trial-balance-2026-12-31.csv',
    );
    expect(filenameFrom('attachment; filename=zoho-accounts.csv', '/x.csv')).toBe(
      'zoho-accounts.csv',
    );
  });

  it('falls back to the address’s own last segment, without the query', () => {
    expect(filenameFrom(null, '/api/accounting/statements/cash-flow.csv?from=a&to=b')).toBe(
      'cash-flow.csv',
    );
    expect(filenameFrom('attachment', '/api/accounting/exports/zoho-accounts.csv')).toBe(
      'zoho-accounts.csv',
    );
  });
});

describe('downloadCsv', () => {
  it('asks for the path through apiFetch, and hands the bytes over once', async () => {
    const asked: string[] = [];
    const apiFetch = vi.fn(async (path: string) => {
      asked.push(path);
      return csvResponse('attachment; filename="trial-balance-2026-12-31.csv"');
    }) as unknown as ApiFetch;
    const watch = watchClicks();

    const path = '/api/accounting/statements/trial-balance.csv?asOf=2026-12-31';
    await expect(downloadCsv(apiFetch, path)).resolves.toBe(true);

    expect(asked).toEqual([path]);
    expect(watch.clicked).toEqual([{ name: 'trial-balance-2026-12-31.csv', href: created[0] }]);
    // The anchor is temporary: nothing of it is left in the document.
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(created).toHaveLength(1);
    await vi.waitFor(() => expect(revoked).toEqual(created));
    watch.stop();
  });

  it('names the file after the address when the server sends no name', async () => {
    const apiFetch = vi.fn(async () => csvResponse(null)) as unknown as ApiFetch;
    const watch = watchClicks();
    await downloadCsv(apiFetch, '/api/accounting/exports/zoho-journal.csv?from=a&to=b');
    expect(watch.clicked.map((one) => one.name)).toEqual(['zoho-journal.csv']);
    watch.stop();
  });

  it('answers no on a refusal, and holds no address open', async () => {
    const apiFetch = vi.fn(
      async () => new Response('{"error":"forbidden"}', { status: 403 }),
    ) as unknown as ApiFetch;
    await expect(downloadCsv(apiFetch, '/api/accounting/statements/cash-flow.csv')).resolves.toBe(
      false,
    );
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('answers no when the fetch itself fails', async () => {
    const apiFetch = vi.fn(async () => {
      throw new Error('the network went away');
    }) as unknown as ApiFetch;
    await expect(
      downloadCsv(apiFetch, '/api/accounting/statements/balance-sheet.csv?asOf=2026-12-31'),
    ).resolves.toBe(false);
    expect(created).toEqual([]);
  });

  it('says one fixed sentence, and never the server’s own', () => {
    expect(DOWNLOAD_REFUSED).toBe('The file could not be prepared. Try again.');
  });
});
