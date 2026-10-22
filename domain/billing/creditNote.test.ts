import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import {
  creditableFor,
  proportionalVat,
  type CreditableCredit,
  type CreditableInvoice,
} from './creditNote';

/**
 * The specification for what a credit note may credit and the VAT on it
 * (docs/superpowers/specs/2026-10-22-credit-notes-design.md).
 */

function invoice(over: Partial<CreditableInvoice> = {}): CreditableInvoice {
  return {
    id: 'inv-1',
    kind: 'call_out_fee',
    waived: false,
    alreadyCredited: false,
    clientErased: false,
    lines: [{ id: 'line-1', netFils: fils(15_000), vatFils: fils(750) }],
    ...over,
  };
}

function creditsOf(
  n: number,
  status: CreditableCredit['status'],
  allocatedNetFils = 10_000,
  prefix = status,
): CreditableCredit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    status,
    allocatedNetFils: fils(allocatedNetFils),
  }));
}

function planOf(result: ReturnType<typeof creditableFor>) {
  if (!result.ok) throw new Error(`expected a plan, got refusal ${result.refusal}`);
  return result.plan;
}

describe('creditableFor', () => {
  it('credits the whole call-out fee and releases nothing', () => {
    const plan = planOf(creditableFor(invoice(), []));
    expect(plan.netFils).toBe(15_000);
    expect(plan.vatFils).toBe(750);
    expect(plan.grossFils).toBe(15_750);
    expect(plan.releasedNetFils).toBe(0);
    expect(plan.creditedEntitlementIds).toEqual([]);
    expect(plan.lines).toEqual([
      { invoiceLineId: 'line-1', netFils: 15_000, vatFils: 750, grossFils: 15_750 },
    ]);
  });

  it('credits a delivered session invoice to income', () => {
    const plan = planOf(creditableFor(invoice({ kind: 'session' }), creditsOf(1, 'consumed')));
    expect(plan.netFils).toBe(15_000);
    expect(plan.vatFils).toBe(750);
    expect(plan.releasedNetFils).toBe(0);
    expect(plan.creditedEntitlementIds).toEqual([]);
  });

  it('credits a sold-ahead session whose credit is unused from sessions owed', () => {
    const plan = planOf(
      creditableFor(invoice({ kind: 'single_session' }), [
        { id: 'credit-a', status: 'available', allocatedNetFils: fils(15_000) },
      ]),
    );
    expect(plan.netFils).toBe(15_000);
    expect(plan.vatFils).toBe(750);
    expect(plan.releasedNetFils).toBe(15_000);
    expect(plan.creditedEntitlementIds).toEqual(['credit-a']);
  });

  it('credits a session invoice whose credit a void restored as a sold-ahead session', () => {
    // A voided visit waives its consumed credit and writes an available
    // replacement on the same invoice (migration 969). The spec's settled
    // answer: that invoice is treated as single_session.
    const plan = planOf(
      creditableFor(invoice({ kind: 'session' }), [
        { id: 'voided', status: 'waived', allocatedNetFils: fils(15_000) },
        { id: 'restored', status: 'available', allocatedNetFils: fils(15_000) },
      ]),
    );
    expect(plan.netFils).toBe(15_000);
    expect(plan.vatFils).toBe(750);
    expect(plan.releasedNetFils).toBe(15_000);
    expect(plan.creditedEntitlementIds).toEqual(['restored']);
  });

  it('credits a sold-ahead session already used to income', () => {
    const plan = planOf(
      creditableFor(invoice({ kind: 'single_session' }), creditsOf(1, 'consumed', 15_000)),
    );
    expect(plan.netFils).toBe(15_000);
    expect(plan.vatFils).toBe(750);
    expect(plan.releasedNetFils).toBe(0);
    expect(plan.creditedEntitlementIds).toEqual([]);
  });

  it('credits only the seven unused credits of a ten-session package', () => {
    const credits = [...creditsOf(3, 'consumed'), ...creditsOf(7, 'available')];
    const plan = planOf(
      creditableFor(
        invoice({
          kind: 'package',
          lines: [{ id: 'line-1', netFils: fils(100_000), vatFils: fils(5_000) }],
        }),
        credits,
      ),
    );
    expect(plan.netFils).toBe(70_000);
    expect(plan.vatFils).toBe(3_500);
    expect(plan.grossFils).toBe(73_500);
    expect(plan.releasedNetFils).toBe(70_000);
    expect(plan.creditedEntitlementIds).toEqual(creditsOf(7, 'available').map((c) => c.id));
    expect(plan.creditedEntitlementIds).toHaveLength(7);
  });

  it('uses the discounted net a package was sold at', () => {
    const credits = [...creditsOf(1, 'consumed', 9_000), ...creditsOf(9, 'available', 9_000)];
    const plan = planOf(
      creditableFor(
        invoice({
          kind: 'package',
          lines: [{ id: 'line-1', netFils: fils(90_000), vatFils: fils(4_500) }],
        }),
        credits,
      ),
    );
    expect(plan.netFils).toBe(81_000);
    expect(plan.vatFils).toBe(4_050);
    expect(plan.releasedNetFils).toBe(81_000);
  });

  it('refuses a statement', () => {
    expect(creditableFor(invoice({ kind: 'statement' }), [])).toEqual({
      ok: false,
      refusal: 'statement',
    });
  });

  it('refuses a waived invoice', () => {
    expect(creditableFor(invoice({ waived: true }), [])).toEqual({
      ok: false,
      refusal: 'waived',
    });
  });

  it('refuses an invoice already credited', () => {
    expect(creditableFor(invoice({ alreadyCredited: true }), [])).toEqual({
      ok: false,
      refusal: 'already_credited',
    });
  });

  it('refuses a package whose credits are all used', () => {
    expect(
      creditableFor(
        invoice({
          kind: 'package',
          lines: [{ id: 'line-1', netFils: fils(100_000), vatFils: fils(5_000) }],
        }),
        creditsOf(10, 'consumed'),
      ),
    ).toEqual({ ok: false, refusal: 'nothing_left' });
  });

  it("refuses an erased client's invoice", () => {
    expect(creditableFor(invoice({ clientErased: true }), [])).toEqual({
      ok: false,
      refusal: 'client_erased',
    });
  });

  it('checks the erased client first, then the other refusals in order', () => {
    expect(
      creditableFor(invoice({ clientErased: true, kind: 'statement', waived: true }), []),
    ).toEqual({ ok: false, refusal: 'client_erased' });
    expect(
      creditableFor(invoice({ kind: 'statement', waived: true, alreadyCredited: true }), []),
    ).toEqual({ ok: false, refusal: 'statement' });
    expect(creditableFor(invoice({ waived: true, alreadyCredited: true }), [])).toEqual({
      ok: false,
      refusal: 'waived',
    });
  });
});

describe('proportionalVat', () => {
  it('rounds half away from zero and never exceeds the line', () => {
    expect(proportionalVat(fils(5_000), fils(100_000), fils(70_000))).toBe(3_500);
    expect(proportionalVat(fils(1), fils(3), fils(2))).toBe(1);
    expect(proportionalVat(fils(5), fils(10), fils(10))).toBe(5);
    expect(proportionalVat(fils(5), fils(10), fils(15))).toBe(5);
  });

  it('is zero for a line with no net', () => {
    expect(proportionalVat(fils(0), fils(0), fils(0))).toBe(0);
  });
});
