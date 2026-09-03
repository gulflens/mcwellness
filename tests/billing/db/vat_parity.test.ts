import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveVat } from '../../../domain/billing';
import { fils } from '../../../domain/shared';
import { freshDatabase } from '../../db/helpers';

/**
 * The two places VAT is worked out, agreeing to the fils.
 *
 * `domain/billing/vat.ts` is the one rule (CLAUDE.md rule 6), and every route
 * runs it. But `app.charge_single_visit` (404_billing_consumption.sql) is
 * SQL, invoked by a trigger with no route above it, and it does the same
 * arithmetic in Postgres: `round(net * rate / 10000)` against JavaScript's
 * `Math.round(net * rate / 10000)`.
 *
 * They happen to agree. They agree because Postgres rounds a numeric half
 * away from zero and JavaScript rounds a number half towards positive
 * infinity, and every amount here is non-negative — a coincidence that holds
 * for the practice's figures and would stop holding the day a credit note
 * carried a negative one. So it is pinned rather than assumed, across a sweep
 * wide enough to hit every half-fils boundary.
 */

const SQL = 'select round($1::numeric * $2 / 10000)::int as vat';

let db: pg.Client;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.end();
});

describe('the VAT in the database and the VAT in the domain', () => {
  it("agree on the practice's own figures", async () => {
    for (const net of [0, 70_000, 82_500, 1_032_500, 1_697_500, 2_660_500]) {
      const { rows } = await db.query<{ vat: number }>(SQL, [net, 500]);
      expect(rows[0]?.vat, `net ${net}`).toBe(
        resolveVat(fils(net), {
          rateBasisPoints: 500,
          version: 1,
        }).vatFils,
      );
    }
  });

  it('agree across every half-fils boundary at the standard rate', async () => {
    // At 5%, a net amount ending in 10 fils lands exactly on .5 — the case
    // where two rounding rules can part company. This walks a thousand of
    // them.
    for (let net = 0; net <= 20_000; net += 10) {
      const { rows } = await db.query<{ vat: number }>(SQL, [net, 500]);
      expect(rows[0]?.vat, `net ${net}`).toBe(
        resolveVat(fils(net), {
          rateBasisPoints: 500,
          version: 1,
        }).vatFils,
      );
    }
  });

  it('agree at other rates, in case the practice ever meets one', async () => {
    for (const rate of [0, 250, 500, 750, 1_000, 2_000]) {
      for (const net of [1, 99, 333, 12_345, 999_999]) {
        const { rows } = await db.query<{ vat: number }>(SQL, [net, rate]);
        expect(rows[0]?.vat, `net ${net} at ${rate}`).toBe(
          resolveVat(fils(net), { rateBasisPoints: rate, version: 1 }).vatFils,
        );
      }
    }
  });
});
