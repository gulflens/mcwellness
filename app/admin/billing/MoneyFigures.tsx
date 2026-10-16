import type { MonthlyMoneyResponse } from '../../api/billing/document-schema';
import { formatFils } from './money';

/**
 * Three facts about the month, and nothing else (docs/SPEC/billing.md section
 * 4.1).
 *
 * They sit together because apart they mislead. What was received is what came
 * in; revenue recognised is what was actually earned by delivering; the third
 * is what the practice still owes in sessions. Ten programmes sold in a launch
 * month is a great deal of money in the bank and roughly six months of work
 * owed, and only the three together say so.
 *
 * **Cash first, in the Books overview's own words.** The practice suggested
 * money be counted only when a receipt is issued; the operator kept the books
 * on accruals and decided on 2026-10-06 that the figures lead with cash. So the
 * receipts stand alone at the top, and the two accrual figures come after them,
 * quieter, under "Earned and owed (from invoices and sessions)" — the same
 * order and the same labels as app/admin/accounting/OverviewSection.tsx, so
 * the two screens never describe one month two ways.
 *
 * **Two of them are net and one is gross, and each says which.** What was
 * received is money that arrived, VAT and all; revenue recognised and the
 * deferred balance are allocated net values off the entitlement ledger. Set
 * side by side without saying so — which is how they first shipped — they read
 * as three figures on one basis, and the arithmetic a reader would do between
 * them would be wrong. Today the practice charges no VAT, so the three happen
 * to be on the same basis; the lines are for the day it registers, which is
 * the day nobody will re-read this component.
 *
 * Quiet on purpose: no charts, no trend arrows, no comparison with last
 * month. Nothing here is trying to be a dashboard.
 */
export function MoneyFigures({ figures }: { figures: MonthlyMoneyResponse }) {
  return (
    <>
      <dl className="figures">
        <div className="figures__item">
          <dt>Received this month (receipts, AED)</dt>
          <dd className="numeric">{formatFils(figures.cashCollectedFils)}</dd>
          <dd className="small muted">What arrived, including any VAT.</dd>
        </div>
      </dl>
      <h2 className="figures__heading figures__heading--quiet">
        Earned and owed (from invoices and sessions)
      </h2>
      <dl className="figures figures--secondary">
        <div className="figures__item">
          <dt>Revenue recognised this month (AED)</dt>
          <dd className="numeric">{formatFils(figures.revenueRecognisedFils)}</dd>
          <dd className="small muted">
            Earned when a session is delivered, whether or not it has been paid. Net of VAT.
          </dd>
        </div>
        <div className="figures__item">
          <dt>Sessions owed (AED)</dt>
          <dd className="numeric">{formatFils(figures.deferredNetFils)}</dd>
          {/* What the third figure is, in the words the spec uses for it. */}
          <dd className="small muted">Paid for in advance, not yet delivered. Net of VAT.</dd>
        </div>
      </dl>
    </>
  );
}
