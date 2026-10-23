import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractAll } from '../../../domain/billing/document';
import { SEED_TENANT_ID, SEED_TODAY } from '../../../db/seed/generate';
import { seedUser } from '../../db/helpers';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * A household's statement of account as a PDF (docs/superpowers/specs/
 * 2026-10-23-debtors-design.md). What is on the page is tested in
 * tests/billing/document.test.ts and the sums in domain/billing/ageing.test.ts;
 * this file is about the door: who may knock, what is audited, the period's
 * defaults and what the file is called.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const FINANCE_ONLY = {
  userId: '0000000d-0000-4000-8000-0000000000f1',
  authId: '0000000d-0000-4000-8000-0000000000f2',
} as const;
const UNKNOWN = '0000000d-0000-4000-8000-00000000ffff';

let h: Harness;

async function actAsOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000d8', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
}

async function invoice(clientId: string, issuedOn: string, grossFils: number): Promise<void> {
  await actAsOwner();
  await h.owner.query(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, $4, 0, $4)",
    [h.data.tenant.id, clientId, issuedOn, grossFils],
  );
}

async function mrnOf(clientId: string): Promise<string> {
  const { rows } = await h.owner.query<{ mrn: string }>('select mrn from client where id = $1', [
    clientId,
  ]);
  return String(rows[0]?.mrn);
}

async function readCount(clientId: string): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from audit_log where action = 'read' " +
      "and entity_type = 'billing_ledger' and client_id = $1",
    [clientId],
  );
  return Number(rows[0]?.n);
}

function statementPath(clientId: string, query = ''): string {
  return `/api/billing/clients/${clientId}/statement.pdf${query}`;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  await seedUser(h.owner, {
    id: FINANCE_ONLY.userId,
    tenantId: SEED_TENANT_ID,
    authId: FINANCE_ONLY.authId,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
  await invoice(h.clientId(0), '2026-08-15', 15_000);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('GET /api/billing/clients/:id/statement.pdf', () => {
  it('streams a PDF for finance, named by record number and the end of the period', async () => {
    const client = h.clientId(0);
    const res = await h.callAs('GET', statementPath(client), FINANCE_ONLY.authId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const mrn = await mrnOf(client);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="statement-${mrn}-${SEED_TODAY}.pdf"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const page = extractAll(bytes);
    expect(page).toContain(mrn);
    expect(page).toContain('150.00');
  });

  it('refuses a practitioner with a 403', async () => {
    const res = await h.call('GET', statementPath(h.clientId(0)), SEEDED.practitioner);
    expect(res.status).toBe(403);
  });

  it('writes one audited read for the client', async () => {
    const client = h.clientId(0);
    const before = await readCount(client);
    expect((await h.call('GET', statementPath(client), SEEDED.owner)).status).toBe(200);
    expect((await readCount(client)) - before).toBe(1);
  });

  it('answers 404 for an unknown id, and writes no read', async () => {
    const before = await readCount(UNKNOWN);
    expect((await h.call('GET', statementPath(UNKNOWN), SEEDED.owner)).status).toBe(404);
    expect(await readCount(UNKNOWN)).toBe(before);
  });

  it('answers 404 for an erased client', async () => {
    const client = h.clientId(5);
    await invoice(client, '2026-09-01', 9_000);
    const user = h.data.users[SEEDED.owner];
    const { rows: requested } = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, created_by) ' +
        "values ($1, $2, 'The household asked.', $3) returning id",
      [h.data.tenant.id, client, user?.id],
    );
    await h.owner.query(
      "select set_config('app.actor_id', $1, false), set_config('app.actor_roles', 'owner', false), " +
        "set_config('app.reason', 'The household asked.', false)",
      [user?.id],
    );
    await h.owner.query('select app.erase_client($1, $2)', [client, requested[0]?.id]);

    expect((await h.call('GET', statementPath(client), SEEDED.owner)).status).toBe(404);
  });

  it('defaults the period to the month two months back through Dubai today', async () => {
    // SEED_TODAY's month less two, from its first day: the opening balance row
    // is dated that day and the closing row today.
    const [year, month] = SEED_TODAY.split('-').map(Number) as [number, number];
    const first = new Date(Date.UTC(year, month - 3, 1));
    const from = first.toISOString().slice(0, 10);
    const res = await h.call('GET', statementPath(h.clientId(0)), SEEDED.owner);
    expect(res.headers.get('content-disposition')).toContain(SEED_TODAY);
    const page = extractAll(new Uint8Array(await res.arrayBuffer()));
    const long = (iso: string) =>
      `${Number(iso.slice(8))} ${
        [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ][Number(iso.slice(5, 7)) - 1]
      } ${iso.slice(0, 4)}`;
    expect(page).toContain(long(from));
    expect(page).toContain(long(SEED_TODAY));
  });

  it('honours an explicit period', async () => {
    const res = await h.call(
      'GET',
      statementPath(h.clientId(0), '?from=2026-01-01&to=2026-08-31'),
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('-2026-08-31.pdf');
  });

  it('refuses a from after the to with a 400', async () => {
    const res = await h.call(
      'GET',
      statementPath(h.clientId(0), '?from=2026-09-01&to=2026-08-01'),
      SEEDED.owner,
    );
    expect(res.status).toBe(400);
  });

  it('refuses a malformed date with a 400', async () => {
    const res = await h.call('GET', statementPath(h.clientId(0), '?from=2026-13-45'), SEEDED.owner);
    expect(res.status).toBe(400);
  });
});
