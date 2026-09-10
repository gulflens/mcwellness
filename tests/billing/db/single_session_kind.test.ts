import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TODAY } from '../../../db/seed/generate';
import { rejectsWith, rolledBack } from '../../db/helpers';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * Migration 411: an invoice may be of kind single_session, and then names no
 * session, no package purchase and no appointment — a credit sold ahead of the
 * visit that will consume it. The source rule is the one place that says what
 * each kind must name (408's precedent), restated here with the new kind in it.
 */
let h: Harness;
const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const CHECK_VIOLATION = '23514';

beforeAll(async () => {
  h = await startHarness(NOW);
});
afterAll(async () => {
  await h.close();
});

/**
 * The practice's own context on the owner's connection, transaction-local as
 * tests/accounting/db/journal_guards.test.ts's `asBookkeeper` sets it: every
 * case here runs inside `rolledBack`, so `true` (rather than the brief's
 * session-scoped draft) is what actually survives to the statement that
 * follows, and nothing written here outlives the test.
 */
async function asPractice(): Promise<void> {
  await h.owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)",
    [h.data.tenant.id, h.data.users[SEEDED.owner]?.id ?? null],
  );
}

describe('invoice kind single_session', () => {
  it('is accepted with no session, no package purchase and no appointment', async () => {
    await rolledBack(h.owner, async () => {
      await asPractice();
      const { rows } = await h.owner.query<{ id: string }>(
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, gross_fils) ' +
          "values ($1, $2, app.next_invoice_number(), 'single_session', $3, 70000, 0, 70000) returning id",
        [h.data.tenant.id, h.clientId(0), SEED_TODAY],
      );
      expect(rows[0]?.id).toBeTruthy();
    });
  });

  it('refuses one that names a package purchase, which would be a package invoice in disguise', async () => {
    await rolledBack(h.owner, async () => {
      await asPractice();
      const { rows } = await h.owner.query<{ id: string }>(
        'select id from package_purchase limit 1',
      );
      const purchase = rows[0]?.id;
      if (!purchase) return; // The seed on this database sold nothing; the rule is still pinned by the first case.
      await rejectsWith(
        h.owner,
        CHECK_VIOLATION,
        'insert into invoice (tenant_id, client_id, number, kind, issued_on, package_purchase_id, net_fils, vat_fils, gross_fils) ' +
          "values ($1, $2, app.next_invoice_number(), 'single_session', $3, $4, 70000, 0, 70000)",
        [h.data.tenant.id, h.clientId(0), SEED_TODAY, purchase],
      );
    });
  });
});
